// deterministic recording: Playwright's clock drives rAF/performance.now; one screenshot per 1/30 s
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const fs = require('fs');
const [url, framesDir, secs] = process.argv.slice(2);
(async () => {
  fs.mkdirSync(framesDir, { recursive: true });
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await ctx.clock.install({ time: 0 });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.error('PAGEERR', e.message));
  await p.goto(url);
  for (let i = 0; i < 100 && !(await p.evaluate(() => window.ready && window.ready())); i++) await p.clock.runFor(50);
  await p.clock.runFor(1500);
  await p.evaluate(() => window.go());
  const n = Math.round(+secs * 30);
  for (let i = 0; i < n; i++) { await p.clock.runFor(1000 / 30); await p.screenshot({ path: `${framesDir}/${String(i).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 92 }); }
  await b.close();
})();
