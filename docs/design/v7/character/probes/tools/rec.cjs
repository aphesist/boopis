// deterministic recording: Playwright's clock drives rAF and performance.now; one screenshot per 1/30 s.
// usage: node rec.cjs <url> <framesDir> <seconds> [dpr]. Writes rects.json: every orb canvas's box (parent CSS px), by half,
// and stats.json: per frame and per orb, read from the canvas's own pixels (exact, before any encoding):
//   ch    pixels that changed since the last frame
//   aba   silhouette pixels that toggled: alpha moved by more than 24 last frame and came back within 4 this frame (A-B-A)
//   rest  1 when the bot is at rest: reaction "pose", not hovered, nothing changed on it for 1.5 s (then ch must be 0)
//   x, y  the canvas's screen position (device px), to catch a canvas that jumps; w the backing width, to catch a refit
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const fs = require('fs');
const [url, framesDir, secs, dpr] = process.argv.slice(2);
(async () => {
  fs.mkdirSync(framesDir, { recursive: true });
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: +(dpr || 1) });
  await ctx.clock.install({ time: 0 });
  const p = await ctx.newPage();
  await p.clock.pauseAt(1000);   /* time moves only by runFor: a frame is exactly 1/30 s, whatever a screenshot costs */
  p.on('pageerror', (e) => console.error('PAGEERR', e.message));
  await p.goto(url);
  for (let i = 0; i < 100 && !(await p.evaluate(() => window.ready && window.ready())); i++) await p.clock.runFor(50);
  await p.clock.runFor(1500);
  const rects = await p.evaluate(() => [...document.querySelectorAll('iframe')].map((f, k) => { const fr = f.getBoundingClientRect();
    return [...f.contentDocument.querySelectorAll('orb-avatar')].map((o) => { const c = o.shadowRoot.querySelector('canvas').getBoundingClientRect(), h = o.getBoundingClientRect();
      return { half: k, size: +o.getAttribute('size'), shape: o.getAttribute('shape'), bot: o.closest('[data-bot]')?.dataset.bot, x: fr.left + c.left, y: fr.top + c.top, w: c.width, h: c.height, hx: fr.left + h.left, hy: fr.top + h.top, hw: h.width }; }); }).flat());
  fs.writeFileSync(framesDir + '/rects.json', JSON.stringify({ dpr: +(dpr || 1), rects }));
  await p.evaluate(() => { window.__T = 0; for (const f of document.querySelectorAll('iframe')) for (const o of f.contentDocument.querySelectorAll('orb-avatar')) {
    o.__chg = 0; new f.contentWindow.MutationObserver(() => { o.__chg = window.__T; }).observe(o, { attributes: true }); } });
  await p.evaluate(() => window.go());
  const n = Math.round(+secs * 30), stats = [];
  const STAT = (t) => { window.__T = t; const dpr = devicePixelRatio; return [...document.querySelectorAll('iframe')].map((f) => { const fr = f.getBoundingClientRect();
    return [...f.contentDocument.querySelectorAll('orb-avatar')].map((o) => {
      const cv = o.shadowRoot.querySelector('canvas'), r = cv.getBoundingClientRect(), w = cv.width, h = cv.height;
      if (o.__w !== w) { o.__p1 = o.__p2 = null; o.__w = w; }
      if (o._hover) o.__chg = t;
      const d = w && h ? cv.getContext('2d').getImageData(0, 0, w, h).data : new Uint8ClampedArray(0);
      let ch = 0, aba = 0; const p1 = o.__p1, p2 = o.__p2;
      if (p1) for (let i = 0; i < d.length; i += 4) {
        if (d[i] !== p1[i] || d[i + 1] !== p1[i + 1] || d[i + 2] !== p1[i + 2] || d[i + 3] !== p1[i + 3]) ch++;
        if (p2 && Math.abs(p1[i + 3] - p2[i + 3]) > 24 && Math.abs(d[i + 3] - p2[i + 3]) <= 4) aba++;
      }
      o.__p2 = p1; o.__p1 = d;
      const rest = o.getAttribute('reaction') === 'pose' && !o._hover && t - o.__chg >= 1.5 ? 1 : 0;
      return { ch, aba, rest, x: Math.round((fr.left + r.left) * dpr * 100) / 100, y: Math.round((fr.top + r.top) * dpr * 100) / 100, w };
    }); }).flat(); };
  for (let i = 0; i < n; i++) { await p.clock.runFor(1000 / 30); stats.push(await p.evaluate(STAT, (i + 1) / 30)); await p.screenshot({ path: `${framesDir}/${String(i).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 95 }); }
  fs.writeFileSync(framesDir + '/stats.json', JSON.stringify(stats));

  await b.close();
})();
