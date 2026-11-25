// usage: node shot.cjs <url> <out.jpg> <w> <h> [wait]
const { chromium } = require('playwright');
(async () => {
  const [url, out, w, h, wait] = process.argv.slice(2);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 2 });
  p.on('pageerror', e => console.error('PAGEERR', e.message));
  p.on('console', m => { if (m.type() === 'error') console.error('CONSOLE', m.text()); });
  await p.goto(url, { waitUntil: 'load' });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(+(wait || 1500));
  await p.screenshot({ path: out, type: 'jpeg', quality: 86, fullPage: true });
  await b.close();
})();
