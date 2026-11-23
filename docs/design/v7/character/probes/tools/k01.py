import numpy as np, sys, json
from PIL import Image, ImageDraw, ImageFont
W = sys.argv[1]; G = sys.argv[2]; OUT = sys.argv[3]
F = lambda s, b=False: ImageFont.truetype('/usr/share/fonts/opentype/inter/Inter-%s.otf' % ('SemiBold' if b else 'Regular'), s)
SURF = ['row', 'gutter', 'rail', 'details', 'grok-rail', 'room', 'dock', 'main-a', 'main-b', 'preview']
SIZE = dict(zip(SURF, [20, 20, 24, 28, 36, 40, 40, 44, 56, 64]))
def cell(v, dpr, s, bot=0):
    im = Image.open(f'{W}/cl-{v}-{dpr}.png').convert('RGB'); j = SURF.index(s); c = 96 * dpr
    cx, cy = (j + .5) * c, (bot + .5) * c; h = SIZE[s] * dpr * .62
    return im.crop((round(cx - h), round(cy - h), round(cx + h), round(cy + h)))
def edge(img):
    a = np.asarray(img).astype(float); bg = a[1, 1]
    d = np.linalg.norm(a - bg, axis=2); full = np.percentile(d, 99); L = d / max(full, 1)
    m = L > .5; soft = ((L > .1) & (L < .9)).sum()
    per = (m[1:, :] != m[:-1, :]).sum() + (m[:, 1:] != m[:, :-1]).sum()
    return soft / max(per, 1)
def grok(path, box):
    return Image.open(path).convert('RGB').crop(box)
S = G + '/screens/'
GR = {  # Grok-Bot crops at DPR 2 (its screens are 2880 px wide for a 1440 px window)
    'main-a': grok(S + '157-live-sidebar-expanded.png', (171, 117, 279, 225)),   # main bot, 44 px body
    'grok-rail': grok(S + '010-chat-sidebar-compact.png', (40, 90, 130, 180)),    # rail tile avatar, 36 px
    'row': grok(S + '157-live-sidebar-expanded.png', (26, 386, 98, 458)),          # list row avatar, 28 px
}
res = {}
for k, im in GR.items(): res['grok ' + k] = round(edge(im), 2)
pick = ['row', 'rail', 'grok-rail', 'main-a', 'dock']
for s in pick:
    for dpr in [1, 1.6, 2]:
        for v in ['stock', 'snap', 'ladder']:
            res[f'{s} {dpr} {v}'] = round(edge(cell(v, dpr, s)), 2)
json.dump(res, open(W + '/k01-metrics.json', 'w'), indent=1)
# board
Z = 3  # 3:1 of device pixels is shown for the 1:1 device crop at 2:1 CSS for DPR 1.6/2? keep it simple: each crop at 1:1 and at Z:1 nearest
pad = 24; colw = 300; rowh = 0
rows = []
for s in ['row', 'rail', 'main-a', 'dock']:
    for dpr in [1, 1.6, 2]:
        rows.append((s, dpr))
H = 170 + len(rows) * 210 + 260
board = Image.new('RGB', (pad * 2 + 170 + colw * 4, H), (18, 18, 18)); d = ImageDraw.Draw(board)
d.text((pad, 20), 'K01  Why our orbs read less clearly than Grok-Bot\'s: the same orb, as the app places it today and snapped to device pixels', font=F(22, True), fill=(240, 240, 240))
d.text((pad, 56), 'Chromium, boopis\'s orb2 build (03d9094) and its .ui-orb wrapper. Each crop: 1:1 device pixels on the left, 3:1 nearest-neighbour on the right. "edge" is the mean width of the', font=F(15), fill=(170, 170, 170))
d.text((pad, 78), 'anti-aliased transition in device pixels (body and eyes; lower is crisper; a clean 1-sample AA edge is about 1.0). The ladder column is orb2 after its quality ladder steps to level 2.', font=F(15), fill=(170, 170, 170))
hdr = ['today (stock)', 'snapped (C1-C3)', 'today, ladder stepped', 'Grok-Bot, same size, DPR 2']
for i, h in enumerate(hdr): d.text((pad + 170 + i * colw, 120), h, font=F(16, True), fill=(230, 230, 230))
y = 150
LBL = {'row': 'sidebar row 20 px', 'rail': 'rail 24 px', 'main-a': 'main bot 44 px', 'dock': 'dock 40 px (render 80)'}
for s, dpr in rows:
    d.text((pad, y + 10), LBL[s], font=F(15, True), fill=(230, 230, 230)); d.text((pad, y + 32), f'DPR {dpr}', font=F(15), fill=(170, 170, 170))
    for i, v in enumerate(['stock', 'snap', 'ladder', 'grok']):
        x = pad + 170 + i * colw
        if v == 'grok':
            key = {'row': 'row', 'rail': 'grok-rail', 'main-a': 'main-a'}.get(s)
            if dpr != 2 or not key: continue
            im = GR[key]; e = res['grok ' + key]
            if s == 'row': d.text((x, y + 182), 'its row avatar is 28 px', font=F(12), fill=(140, 140, 140))
            if s == 'rail': d.text((x, y + 182), 'its rail avatar is 36 px', font=F(12), fill=(140, 140, 140))
        else:
            im = cell(v, dpr, s); e = res[f'{s} {dpr} {v}']
        sc = min(Z, 170 / im.width)
        board.paste(im, (x, y)); zoom = im.resize((round(im.width * sc), round(im.height * sc)), Image.NEAREST)
        board.paste(zoom, (x + im.width + 8, y))
        col = (120, 220, 140) if e < 1.25 else (240, 180, 90) if e < 1.6 else (255, 110, 100)
        d.text((x, y + 160), f'edge {e:.2f} px', font=F(14, True), fill=col)
    y += 210
notes = ['C1  orb2 sizes its canvas 153.85% of the box and centres it with translate(-50%,-50%): a 20 px orb gets a 30.77 px canvas at x = -5.38 px, so a 31 px bitmap is resampled to 30.77 px at a 0.62 px offset.',
         'C2  orb2\'s quality ladder (LEVELS, dpr 2 / 1.5 / 1) lowers the backing store after 45 slow frames: on a 2x screen every orb is then drawn at 1x and stretched 2:1 (column 3). CPU-painted WebKitGTK steps it most.',
         'C3  boopis\'s dock draws a 40 px orb at 80 and scales it by 0.5 (views.ts:27, components.css:642): a 2:1 downsample at a half-pixel offset. Snapping cannot fix a scaled orb; draw it at 40.',
         'Not causes (checked in orb2): no shadowBlur, no filter, no gradients, no imageSmoothing changes; fills are flat sRGB, body and eyes keep their exact hex values at rest (measured, see ORBS.md).']
for i, n in enumerate(notes): d.text((pad, y + 10 + i * 26), n, font=F(14), fill=(200, 200, 200))
board.save(OUT, quality=90)
print(json.dumps(res))
