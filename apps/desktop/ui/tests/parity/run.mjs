/* Visual parity: the approved v6 mock-up against the port, at 1440x900 and 1920x1080, in each preset, in the session and
   the bots tab. Twice: with the orbs hidden (their idle motion is random by design, so no two frames agree: everything
   else, the layout, type, colour, corners and the dock's black slab, is compared pixel by pixel), and with every orb frozen
   to a still frame (the orbs' own pixels, within the same threshold). The rects of all orbs must be identical.
   Diffs go to test-results/parity/ (gitignored). Any visible difference is a bug unless an intentional fix is named. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { chromium, OUT, open, startServers } from '../lib.mjs';

const require = createRequire(import.meta.url);
const { PNG } = require('pngjs');
const pixelmatch = (await import('pixelmatch')).default;

const MAX_RATIO = Number(process.env.PARITY_MAX_RATIO || 0.0005);   // 0.05% of the pixels
const PRESETS = ['catalog', 'graphite', 'bone', 'typewriter'];
const SIZES = [[1440, 900], [1920, 1080]];
const TABS = ['session', 'bots'];
const dir = join(OUT, 'parity'); mkdirSync(dir, { recursive: true });

const STILL = `orb-avatar{visibility:hidden!important} *,*::before,*::after{caret-color:transparent!important}`;
/* orbs: `visible` freezes every orb to one still frame instead of hiding it; the rects of all orbs are compared either way */
async function shot(page, visible) {
  if (visible) await page.evaluate(() => { for (const o of document.querySelectorAll('orb-avatar')) o.setAttribute('static', ''); });
  else await page.addStyleTag({ content: STILL });
  await page.addStyleTag({ content: '*,*::before,*::after{caret-color:transparent!important}' });
  await page.evaluate(() => { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); });
  await page.waitForTimeout(1300);   // the dock's springs and the shell's layout settle
  return page.screenshot({ animations: 'disabled' });
}
const orbRects = (page) => page.evaluate(() => [...document.querySelectorAll('orb-avatar')].map((o) => { const r = o.getBoundingClientRect(); return [Math.round(r.left * 10) / 10, Math.round(r.top * 10) / 10, Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10].join(','); }).join('|'));
const srv = await startServers();
const browser = await chromium.launch();
const rows = [];
let failed = 0;
for (const orbs of [false, true]) for (const preset of PRESETS) for (const [w, h] of SIZES) for (const tab of TABS) {
  const q = `preset=${preset}&tab=${tab}`;
  const a = await open(browser, { which: 'v6', origin: srv.origin, w, h, q });
  const b = await open(browser, { which: 'port', origin: srv.origin, w, h, q });
  const [ra, rb] = [await orbRects(a), await orbRects(b)];
  const [sa, sb] = [await shot(a, orbs), await shot(b, orbs)];
  const A = PNG.sync.read(sa), B = PNG.sync.read(sb);
  const name = `${preset}-${tab}-${w}x${h}${orbs ? '-orbs-frozen' : ''}`;
  let diff = 0, ratio = 1;
  if (A.width === B.width && A.height === B.height) {
    const D = new PNG({ width: A.width, height: A.height });
    diff = pixelmatch(A.data, B.data, D.data, A.width, A.height, { threshold: 0.1, includeAA: false });
    ratio = diff / (A.width * A.height);
    if (diff) { writeFileSync(join(dir, name + '.diff.png'), PNG.sync.write(D)); writeFileSync(join(dir, name + '.port.png'), sb); writeFileSync(join(dir, name + '.v6.png'), sa); }
  } else { writeFileSync(join(dir, name + '.port.png'), sb); writeFileSync(join(dir, name + '.v6.png'), sa); }
  const ok = ratio <= MAX_RATIO && !b.errors.length && ra === rb;
  if (!ok) failed++;
  rows.push({ name, diffPixels: diff, ratio: +(ratio * 100).toFixed(4) + '%', orbRects: ra === rb ? 'same' : 'DIFFERENT', errors: b.errors.length, ok });
  await a.ctx.close(); await b.ctx.close();
}
console.table(rows);
writeFileSync(join(dir, 'report.json'), JSON.stringify(rows, null, 2));
await browser.close(); await srv.close();
console.log(failed ? `PARITY FAILED: ${failed} of ${rows.length}` : `parity ok: ${rows.length} comparisons, max ${MAX_RATIO * 100}% of pixels`);
process.exit(failed ? 1 : 0);
