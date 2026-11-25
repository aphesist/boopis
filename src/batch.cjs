// node batch.cjs jobs.json : [{url, out, w, h, wait, full}]
const { chromium } = require('playwright');
const jobs = require(require('path').resolve(process.argv[2]));
(async () => {
  const b = await chromium.launch();
  for (const j of jobs) {
    const p = await b.newPage({ viewport: { width: j.w, height: j.h }, deviceScaleFactor: 2 });
    p.on('pageerror', e => console.error('PAGEERR', j.out, e.message));
    p.on('console', m => { if (m.type() === 'error') console.error('CONSOLE', j.out, m.text()); });
    await p.goto(j.url, { waitUntil: 'load' });
    await p.evaluate(() => document.fonts.ready);
    const H = await p.evaluate(() => document.documentElement.scrollHeight);
    if (H > j.h) await p.setViewportSize({ width: j.w, height: H });
    await p.waitForTimeout(300);
    await p.evaluate(() => { window.V7 && V7.eyes(); window.V7 && V7.paint(); });
    await p.waitForTimeout(j.wait || 1600);
    await p.screenshot({ path: j.out, type: 'jpeg', quality: j.q || 84, fullPage: j.full !== false });
    await p.close();
    console.log('ok', j.out);
  }
  await b.close();
})();
