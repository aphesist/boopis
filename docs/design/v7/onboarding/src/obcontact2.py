import glob, os
from PIL import Image, ImageDraw, ImageFont
D = os.path.dirname(os.path.abspath(__file__)) + '/..'
F = ImageFont.load_default(size=22); FB = ImageFont.load_default(size=34)
W = 2400; pad = 40
def thumb(p, w, h=None):
    im = Image.open(p).convert('RGB'); r = w / im.width; im = im.resize((w, int(im.height * r)), Image.LANCZOS)
    return im.crop((0, 0, w, h)) if h and im.height > h else im
boards = sorted(glob.glob(D + '/boards/O0*.jpg')) + sorted(glob.glob(D + '/boards/C0*.jpg'))
dark = sorted(glob.glob(D + '/screens/*-dark.jpg'), key=lambda p: ('SBX'.index(os.path.basename(p)[2]), p))
light = [p.replace('-dark.jpg', '-light.jpg') for p in dark]
strips = sorted(glob.glob(D + '/motion/*-strip.jpg'))
tw = (W - pad * 4) // 3
sw = (W - pad * 5) // 4
rows = [('Boards: the picks O01-O04 and onboarding’s own parts C01-C02', [(thumb(b, tw, int(tw * 0.75)), os.path.basename(b)) for b in boards], 3),
        ('Screens, dark: the Session tab (O-S), the Bots tab (O-B), across both (O-X)', [(thumb(p, sw), os.path.basename(p)) for p in dark], 4),
        ('Key screens, light', [(thumb(p, sw), os.path.basename(p)) for p in light], 4),
        ('Motion, 60 fps: frame strips (the MP4s are beside them in motion/; r = reduced motion)', [(thumb(p, W - pad * 2), os.path.basename(p)) for p in strips], 1)]
H = 120
for title, items, cols in rows:
    H += 70
    for i in range(0, len(items), cols): H += max(t[0].height for t in items[i:i + cols]) + 46
sheet = Image.new('RGB', (W, H), (10, 10, 10)); d = ImageDraw.Draw(sheet)
d.text((pad, 36), 'boopis onboarding, v7 revision 2: one onboarding per tab, the living logomark (contact sheet)', fill=(255, 255, 255), font=FB)
y = 120
for title, items, cols in rows:
    d.text((pad, y + 20), title, fill=(230, 230, 230), font=F); y += 70
    w = (W - pad * (cols + 1)) // cols
    for i in range(0, len(items), cols):
        rh = 0
        for j, (im, name) in enumerate(items[i:i + cols]):
            x = pad + j * (w + pad); sheet.paste(im, (x, y)); d.text((x, y + im.height + 8), name, fill=(160, 160, 160), font=F); rh = max(rh, im.height)
        y += rh + 46
sheet.save(D + '/contact-sheet.jpg', quality=80)
print(sheet.size)
