// A-B-A silhouette toggles of one turning orb's body path, rasterized directly and supersampled (2x, 3x, 4x), over 60 frames
const { chromium } = require('/opt/node-tools/node_modules/playwright');
(async () => { const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 300, height: 300 }, deviceScaleFactor: 2 });
  await ctx.clock.install({ time: 0 }); const p = await ctx.newPage(); await p.clock.pauseAt(1000);
  await p.addInitScript(() => { const P = CanvasRenderingContext2D.prototype, bp = P.beginPath, lt = P.lineTo, mt = P.moveTo, fl = P.fill; window.__polys = [];
    let cur = null; P.beginPath = function () { cur = []; return bp.call(this); }; P.moveTo = function (x, y) { cur && cur.push([x, y]); return mt.call(this, x, y); };
    P.lineTo = function (x, y) { cur && cur.push([x, y]); return lt.call(this, x, y); }; P.fill = function (...a) { if (cur && cur.length > 100 && !this.__mine) window.__polys.push(cur); return fl.apply(this, a); }; });
  await p.goto(process.argv[2]);
  for (let i = 0; i < 100 && !(await p.evaluate(() => document.body.dataset.ready)); i++) await p.clock.runFor(50);
  await p.clock.runFor(1000);
  await p.evaluate(() => { window.__st = {}; window.__aba = {}; });
  for (let i = 0; i < 60; i++) { await p.evaluate(() => { window.__polys = []; }); await p.clock.runFor(32); await p.evaluate(() => {
    const P = window.__polys[0]; if (!P) return; const cv = document.querySelector('orb-avatar').shadowRoot.querySelector('canvas'), W = cv.width, k = W / 3.2;
    for (const m of [1, 2, 3, 4]) {
      const o2 = document.createElement('canvas'); o2.width = o2.height = W * m; const h = o2.getContext('2d'); h.__mine = 1; h.setTransform(k * m, 0, 0, k * m, W * m / 2, W * m / 2); h.beginPath(); P.forEach(([x, y], i) => i ? h.lineTo(x, y) : h.moveTo(x, y)); h.closePath(); h.fill();
      let d; if (m === 1) d = h.getImageData(0, 0, W, W).data; else { const o3 = document.createElement('canvas'); o3.width = o3.height = W; const q = o3.getContext('2d'); q.__mine = 1; q.imageSmoothingQuality = 'high'; q.drawImage(o2, 0, 0, W, W); d = q.getImageData(0, 0, W, W).data; }
      const S = window.__st[m] || (window.__st[m] = []); S.push(d); if (S.length > 3) S.shift();
      if (S.length === 3) { let n = 0; for (let j = 3; j < d.length; j += 4) if (Math.abs(S[1][j] - S[0][j]) > 24 && Math.abs(S[2][j] - S[0][j]) <= 4) n++; window.__aba[m] = (window.__aba[m] || 0) + n; }
    } }); }
  console.log(JSON.stringify(await p.evaluate(() => window.__aba))); await b.close(); })();
