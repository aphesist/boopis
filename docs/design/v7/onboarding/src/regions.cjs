// prints the 1280 x 800 regions (x,y,w,h) of the orbs and speakers the frame check tracks, from the stills' layout
const { chromium } = require('playwright'); const path = require('path');
const Q = { B02: ['obB02', '.ob2-hero orb-avatar'], B03: ['obB03', '.ob-job orb-avatar'], B10: ['obB10', '.sb-main orb-avatar, .ob2-row orb-avatar'], B04: ['obB04', '.ob-gt .ob-gt-i, .ob2-orbit orb-avatar'], S03: ['obS03', '.ob-spk'], S01: ['obS01', '.ob-spk'], S05: ['obS05', '.ob-spk'], S07: ['obS07', '.ob-spk'] };
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  for (const [k, [s, sel]] of Object.entries(Q)) {
    await p.goto('file://' + path.resolve(__dirname, 'ob2.html') + '?s=' + s + '&picks=none'); await p.waitForTimeout(400);
    const r = await p.evaluate((sel) => [...document.querySelectorAll(sel)].map((e) => { const r = e.getBoundingClientRect(); const k = 1280 / 1440, pad = 8; return [Math.round((r.left - pad) * k), Math.round((r.top - pad) * k), Math.round((r.width + 2 * pad) * k), Math.round((r.height + 2 * pad) * k)].join(','); }), sel);
    console.log(k, r.join(' '));
  }
  await b.close(); })();
