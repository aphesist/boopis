// deterministic recording: Playwright's clock drives rAF and performance.now; one screenshot per 32 ms (31.25 fps).
// The fake clock fires rAF every 16 ms, so a 1/30 s step got two updates, and every eighth step three: a 48 ms jump
// every 0.27 s that juddered every moving edge in the clips. 32 ms is exactly two updates per frame; encode at 31.25 fps.
// usage: node rec.cjs <url> <framesDir> <seconds> [dpr]. Writes rects.json: every orb canvas's box (parent CSS px), by half,
// and stats.json: per frame and per orb, read from the canvas's own pixels (exact, before any encoding):
//   ch    pixels that changed since the last frame
//   aba   silhouette pixels that toggled: alpha moved by more than 24 last frame and came back within 4 this frame (A-B-A)
//   a, cx, cy  the silhouette's area and centroid (device px)
//   d1, d2  the silhouette's change from two frames back to one frame back, and from two frames back to now (alpha sums,
//           in px): when d2 is well under d1 the whole shape went out and came back (a turnaround), otherwise it moved on
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
  await p.clock.pauseAt(1000);   /* time moves only by runFor: a frame is exactly 32 ms, whatever a screenshot costs */
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
  await p.evaluate((v) => { window.__DUMP = v; }, !!process.env.DUMP);
  await p.evaluate(() => window.go());
  const n = Math.round(+secs * 31.25), stats = [];
  const STAT = (t) => { window.__T = t; const dpr = devicePixelRatio; return [...document.querySelectorAll('iframe')].map((f) => { const fr = f.getBoundingClientRect();
    return [...f.contentDocument.querySelectorAll('orb-avatar')].map((o) => {
      const cv = o.shadowRoot.querySelector('canvas'), r = cv.getBoundingClientRect(), w = cv.width, h = cv.height;
      if (o.__w !== w) { o.__p1 = o.__p2 = null; o.__w = w; }
      if (o._hover) o.__chg = t;
      const d = w && h ? cv.getContext('2d').getImageData(0, 0, w, h).data : new Uint8ClampedArray(0);
      let ch = 0, aba = 0, d1 = 0, d2 = 0, sa = 0, sx = 0, sy = 0; const p1 = o.__p1, p2 = o.__p2;
      for (let i = 3, q = 0; i < d.length; i += 4, q++) { const al = d[i]; if (al) { sa += al; sx += al * (q % w); sy += al * ((q / w) | 0); } }
      if (p1) for (let i = 0; i < d.length; i += 4) {
        if (d[i] !== p1[i] || d[i + 1] !== p1[i + 1] || d[i + 2] !== p1[i + 2] || d[i + 3] !== p1[i + 3]) ch++;
        if (p2) { const u = Math.abs(p1[i + 3] - p2[i + 3]), v = Math.abs(d[i + 3] - p2[i + 3]); d1 += u; d2 += v; if (u > 24 && v <= 4) aba++; }
      }
      let dump = null;
      if (window.__DUMP && aba > 20) { const toURL = (a) => { const k = document.createElement('canvas'); k.width = w; k.height = h; k.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(a), w, h), 0, 0); return k.toDataURL(); }; dump = [toURL(p2), toURL(p1), toURL(d)]; }
      o.__p2 = p1; o.__p1 = d;
      const rest = o.getAttribute('reaction') === 'pose' && !o._hover && t - o.__chg >= 1.5 ? 1 : 0;
      return { dump, ch, aba, d1: Math.round(d1 / 255 * 10) / 10, d2: Math.round(d2 / 255 * 10) / 10, rest, a: Math.round(sa / 255 * 10) / 10, cx: sa ? Math.round(sx / sa * 1000) / 1000 : 0, cy: sa ? Math.round(sy / sa * 1000) / 1000 : 0, x: Math.round((fr.left + r.left) * dpr * 100) / 100, y: Math.round((fr.top + r.top) * dpr * 100) / 100, w };
    }); }).flat(); };
  for (let i = 0; i < n; i++) { await p.clock.runFor(32); stats.push(await p.evaluate(STAT, (i + 1) * .032)); await p.screenshot({ path: `${framesDir}/${String(i).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 95 }); }
  let dn = 0;
  for (const [i, f] of stats.entries()) for (const [j, o] of f.entries()) { if (o.dump) { o.dump.forEach((u, k) => fs.writeFileSync(`${framesDir}/dump-${i}-${j}-${k}.png`, Buffer.from(u.split(',')[1], 'base64'))); dn++; } delete o.dump; }
  fs.writeFileSync(framesDir + '/stats.json', JSON.stringify(stats));

  await b.close();
})();
