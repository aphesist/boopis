// one still of a probe page at DPR 2: node shoot-pose.cjs <url> <out.png> [width] [height]
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const [url, out, w, h] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: +(w || 960), height: +(h || 200) }, deviceScaleFactor: 2 });
  p.on('pageerror', (e) => console.error('PAGEERR', e.message));
  await p.goto(url); await p.waitForSelector('body[data-ready]'); await p.waitForTimeout(500);
  await p.screenshot({ path: out }); await b.close();
})();
