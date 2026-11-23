const { chromium } = require('/opt/node-tools/node_modules/playwright');
(async () => { const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 300, height: 300 }, deviceScaleFactor: 2 });
  await ctx.clock.install({ time: 0 }); const p = await ctx.newPage(); await p.clock.pauseAt(1000); await p.goto(process.argv[2]);
  for (let i = 0; i < 100 && !(await p.evaluate(() => document.body.dataset.ready)); i++) await p.clock.runFor(50);
  await p.clock.runFor(1000); const A = [];
  for (let i = 0; i < 60; i++) { await p.clock.runFor(32); A.push(await p.evaluate(() => { const c = document.querySelector('orb-avatar').shadowRoot.querySelector('canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let s = 0, sy = 0; for (let k = 3, j = 0; k < d.length; k += 4, j++) { s += d[k]; sy += d[k] * Math.floor(j / c.width); } return [s / 255, sy / d.length]; })); }
  const a = A.map((v) => v[0]); const d2 = a.slice(2).map((v, i) => v - 2 * a[i + 1] + a[i]);
  console.log('area', a[0].toFixed(1), '->', a[a.length - 1].toFixed(1), ' max |2nd diff|', Math.max(...d2.map(Math.abs)).toFixed(2), ' mean', (d2.reduce((s, v) => s + Math.abs(v), 0) / d2.length).toFixed(2));
  await b.close(); })();
