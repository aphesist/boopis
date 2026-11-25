// prints the 1280 x 800 regions (x,y,w,h) of the orbs and speakers the frame check tracks, from the stills' layout
const { chromium } = require('playwright'); const path = require('path');
const Q = { P01: ['o3P01', '.ob-spk'], P03: ['o3P03', '.ob-spk'], P04: ['o3P04', '.ob-spk'], S04: ['o3S04', '.ob-spk'], H01: ['o3H01', '.ob-spk'], B01: ['o3B01', '.ob3-ch-orb orb-avatar, .sb-main orb-avatar'], B02: ['o3B02', '.ob3-tm orb-avatar, .sb-main orb-avatar'], B03: ['o3B03', '.ob3-free orb-avatar, .ob-gt-i'], B07: ['o3B08', '.sb-main orb-avatar, .ob2-row orb-avatar'] };
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  for (const [k, [s, sel]] of Object.entries(Q)) {
    await p.goto('file://' + path.resolve(__dirname, 'ob3.html') + '?s=' + s + '&picks=none'); await p.waitForTimeout(400);
    const r = await p.evaluate((sel) => [...document.querySelectorAll(sel)].map((e) => { const r = e.getBoundingClientRect(); const k = 1280 / 1440, pad = 8; return [Math.round((r.left - pad) * k), Math.round((r.top - pad) * k), Math.round((r.width + 2 * pad) * k), Math.round((r.height + 2 * pad) * k)].join(','); }), sel);
    console.log(k, r.join(' '));
  }
  await b.close(); })();
