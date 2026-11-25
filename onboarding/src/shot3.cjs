// node shot3.cjs out_dir name=query ... : renders ob3.html stills at 1440x900 (DPR 1 for quick looks, DPR=2 env for finals)
const { chromium } = require('playwright'); const path = require('path');
(async () => { const [out, ...qs] = process.argv.slice(2); const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: +(process.env.W || 1440), height: 900 }, deviceScaleFactor: +(process.env.DPR || 1) });
  p.on('pageerror', (e) => console.error('PAGEERR', e.message)); p.on('console', (m) => { if (m.type() === 'error') console.error('CONSOLE', m.text()); });
  for (const nq of qs) { const i = nq.indexOf('='), n = nq.slice(0, i), q = nq.slice(i + 1); await p.goto('file://' + path.resolve(__dirname, 'ob3.html') + '?' + q); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(+(process.env.WAIT || 900));
    if (process.env.FULL) { const H = await p.evaluate(() => document.documentElement.scrollHeight); await p.setViewportSize({ width: +(process.env.W || 1440), height: H }); }
    await p.screenshot({ path: path.join(out, n + '.jpg'), type: 'jpeg', quality: 85 }); }
  await b.close(); })();
