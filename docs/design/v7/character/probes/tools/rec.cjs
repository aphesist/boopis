// deterministic recording: Playwright's clock drives rAF and performance.now; one screenshot per 1/30 s.
// usage: node rec.cjs <url> <framesDir> <seconds> [dpr]. Writes rects.json: every orb canvas's box (parent CSS px), by half.
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const fs = require('fs');
const [url, framesDir, secs, dpr] = process.argv.slice(2);
(async () => {
  fs.mkdirSync(framesDir, { recursive: true });
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: +(dpr || 1) });
  await ctx.clock.install({ time: 0 });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.error('PAGEERR', e.message));
  await p.goto(url);
  for (let i = 0; i < 100 && !(await p.evaluate(() => window.ready && window.ready())); i++) await p.clock.runFor(50);
  await p.clock.runFor(1500);
  const rects = await p.evaluate(() => [...document.querySelectorAll('iframe')].map((f, k) => { const fr = f.getBoundingClientRect();
    return [...f.contentDocument.querySelectorAll('orb-avatar')].map((o) => { const c = o.shadowRoot.querySelector('canvas').getBoundingClientRect(), h = o.getBoundingClientRect();
      return { half: k, size: +o.getAttribute('size'), bot: o.closest('[data-bot]')?.dataset.bot, x: fr.left + c.left, y: fr.top + c.top, w: c.width, h: c.height, hx: fr.left + h.left, hy: fr.top + h.top, hw: h.width }; }); }).flat());
  fs.writeFileSync(framesDir + '/rects.json', JSON.stringify({ dpr: +(dpr || 1), rects }));
  await p.evaluate(() => window.go());
  const n = Math.round(+secs * 30);
  const poses = [];
  for (let i = 0; i < n; i++) {
    await p.clock.runFor(1000 / 30); await p.screenshot({ path: `${framesDir}/${String(i).padStart(4, '0')}.png` });
    /* the pose each orb drew this frame (orb2's own fields): the head turn and the eye turn, and whether the body is a circle */
    poses.push(await p.evaluate(() => [...document.querySelectorAll('iframe')].map((f) => [...f.contentDocument.querySelectorAll('orb-avatar')].map((o) => {
      const sp = (o._t - o._spinAt) >= 0 && (o._t - o._spinAt) < 1.05;
      return [+(o._hyaw || 0).toFixed(3), +(o._hpitch || 0).toFixed(3), +(o._eyaw || 0).toFixed(3), +(o._epitch || 0).toFixed(3), o._bodyTo && o._bodyTo.isCircle ? 1 : 0, sp ? 1 : 0]; })).flat()));
  }
  fs.writeFileSync(framesDir + '/poses.json', JSON.stringify(poses));
  await b.close();
})();
