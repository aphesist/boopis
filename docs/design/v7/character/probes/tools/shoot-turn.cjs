const { chromium } = require('/opt/node-tools/node_modules/playwright');
const [base, out] = process.argv.slice(2);
(async () => { const b = await chromium.launch();
  for (const lib of ['stock', 'snap']) for (const dpr of [1, 2]) { const p = await b.newPage({ viewport: { width: 800, height: 400 }, deviceScaleFactor: dpr });
    await p.goto(`${base}/turn.html?lib=${lib}`); await p.waitForSelector('body[data-ready]'); await p.screenshot({ path: `${out}/turn-${lib}-${dpr}.png` }); await p.close(); }
  await b.close(); })();
