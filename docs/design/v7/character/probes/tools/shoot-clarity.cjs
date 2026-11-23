const { chromium } = require('/opt/node-tools/node_modules/playwright');
const [dir, out] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch();
  for (const dpr of [1, 1.6, 2]) for (const v of ['stock', 'snap', 'ladder']) {
    const p = await b.newPage({ viewport: { width: 960, height: 288 }, deviceScaleFactor: dpr });
    p.on('pageerror', (e) => console.error('PAGEERR', e.message));
    await p.goto(`file://${dir}/clarity.html?lib=${v === 'snap' ? 'snap' : 'stock'}${v === 'ladder' ? '&ladder=2' : ''}`);
    await p.waitForSelector('body[data-ready]');
    await p.screenshot({ path: `${out}/cl-${v}-${dpr}.png` });
    const info = await p.evaluate(() => [...document.querySelectorAll('orb-avatar')].slice(0, 10).map((o) => { const c = o.shadowRoot.querySelector('canvas'), r = c.getBoundingClientRect(); return [o.closest('.c').dataset.s, c.width, +(r.width * devicePixelRatio).toFixed(2), +((r.left * devicePixelRatio) % 1).toFixed(3)]; }));
    console.log(dpr, v, JSON.stringify(info));
    await p.close();
  }
  await b.close();
})();
