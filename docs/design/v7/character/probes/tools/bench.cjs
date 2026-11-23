const { chromium } = require('/opt/node-tools/node_modules/playwright');
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  for (const u of process.argv.slice(2)) { await p.goto(u); await p.waitForSelector('body[data-ready]', { timeout: 20000 }); console.log(u.split('?')[1], await p.evaluate(() => document.getElementById('out').textContent)); }
  await b.close(); })();
