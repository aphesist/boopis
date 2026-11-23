const { chromium } = require('/opt/node-tools/node_modules/playwright');
const [dir, out] = process.argv.slice(2);
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 960, height: 288 }, deviceScaleFactor: 2 });
  await p.goto(`file://${dir}/clarity.html?lib=snap&fs=1.25`); await p.waitForSelector('body[data-ready]'); await p.screenshot({ path: `${out}/cl-fs-2.png` }); await b.close(); })();
