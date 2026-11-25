// measures every inline chip's text baseline against its line's (the inline-baseline rule): prints the worst offset in device px
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const out = [];
  for (const url of process.argv.slice(2)) {
    const p = await b.newPage({ viewport: { width: 2600, height: 900 }, deviceScaleFactor: 2 });
    await p.goto(url); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(600);
    const r = await p.evaluate(() => {
      const probe = (el) => { const s = document.createElement('span'); s.textContent = 'x'; s.style.cssText = 'display:inline-block;width:0;height:0;overflow:hidden;vertical-align:baseline'; return s; };
      const res = [];
      for (const chip of document.querySelectorAll('.you, .mention, .b code, .mk2, .blank-count')) {
        const line = chip.parentElement; if (/flex|grid/.test(getComputedStyle(line).display) || chip.getClientRects().length > 1 || chip.classList.contains('gap')) continue; const a = probe(); const c = probe();
        line.insertBefore(a, chip); const t = chip.querySelector(':scope > :not(svg):not(orb-avatar)') || chip; t.appendChild(c);
        const d = Math.abs(a.getBoundingClientRect().bottom - c.getBoundingClientRect().bottom) * 2; a.remove(); c.remove();
        res.push([chip.className, d]);
      }
      return res.sort((x, y) => y[1] - x[1]).slice(0, 3);
    });
    out.push(url.split('?')[1] + ' ' + JSON.stringify(r)); await p.close();
  }
  console.log(out.join('\n')); await b.close();
})();
