// grabs one orb's canvas from the right iframe of clip.html at given frames: node grab.cjs <url> <shape> <f0> <f1> <outDir>
const { chromium } = require('/opt/node-tools/node_modules/playwright'); const fs = require('fs');
const [url, sh, f0, f1, out] = process.argv.slice(2);
(async () => { fs.mkdirSync(out, { recursive: true }); const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  await ctx.clock.install({ time: 0 }); const p = await ctx.newPage(); await p.clock.pauseAt(1000); await p.goto(url);
  for (let i = 0; i < 100 && !(await p.evaluate(() => window.ready && window.ready())); i++) await p.clock.runFor(50);
  await p.clock.runFor(1500); await p.evaluate(() => window.go());
  for (let i = 0; i <= +f1; i++) { await p.clock.runFor(32); if (i >= +f0) { const d = await p.evaluate((s) => { const f = document.querySelectorAll('iframe')[1]; const o = [...f.contentDocument.querySelectorAll('orb-avatar')].find((x) => x.getAttribute('shape') === s); return o.shadowRoot.querySelector('canvas').toDataURL(); }, sh); fs.writeFileSync(`${out}/${String(i).padStart(4, '0')}.png`, Buffer.from(d.split(',')[1], 'base64')); } }
  await b.close(); })();
