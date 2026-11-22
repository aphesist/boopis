/* Render the style frames to PNG with the preinstalled Playwright and the look's own vite server.

     node media/launch/look/render.mjs [--scale 1|2] [--out <dir>] [--url <running server>] [--dir frames|board] [--check] [page ...]

   --dir board renders the storyboard's key frames (board/<beat>.html and <beat>-vertical.html) instead of the style frames.
   --scale 2 renders the owner's copies (3840x2160 for 16:9, 2160x3840 for 9:16, laid out at 1080p); 1 is for checking.
   With no frame names it renders every page in frames/ except the calibration pages (zz-*). Without --url it starts vite
   from apps/desktop/ui (where it is installed) and stops it when done. --check also prints each frame's smallest text as it
   lands on screen (font size times every zoom above it) and fails if any visible text is under 28px at 1080p. */
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const UI = join(ROOT, 'apps/desktop/ui');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const check = args.includes('--check'); if (check) args.splice(args.indexOf('--check'), 1);
const scale = Number(opt('--scale', '1'));
const out = resolve(opt('--out', join(HERE, '.renders')));
let url = opt('--url', '');
const dir = opt('--dir', 'frames');
const names = args.length ? args : readdirSync(join(HERE, dir)).filter((f) => f.endsWith('.html') && !f.startsWith('zz-')).map((f) => f.replace(/\.html$/, ''));

let server = null;
if (!url) {
  const port = 5300 + Math.floor(Math.random() * 400);
  server = spawn(join(UI, 'node_modules/.bin/vite'), ['--config', join(HERE, 'vite.config.mjs'), '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
  url = await new Promise((ok, fail) => {
    const t = setTimeout(() => fail(new Error('vite did not start')), 30000);
    server.stdout.on('data', (b) => { if (/ready in/.test(String(b))) { clearTimeout(t); ok('http://127.0.0.1:' + port + '/'); } });
  });
}

const require = createRequire(join(UI, 'package.json'));
const { chromium } = require('playwright');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
try {
  for (const name of names) {
    const vertical = /-vertical$/.test(name);
    const ctx = await browser.newContext({ viewport: vertical ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 }, deviceScaleFactor: scale });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error(name + ': ' + e.message));
    await page.goto(url + dir + '/' + name + '.html', { waitUntil: 'load' });
    await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 60000 });
    if (check) {
      const small = await page.evaluate(() => {
        const out = [];
        const walk = document.createTreeWalker(document.querySelector('.stage'), NodeFilter.SHOW_TEXT);
        for (let n = walk.nextNode(); n; n = walk.nextNode()) {
          const text = n.textContent.trim(); const el = n.parentElement;
          if (!text || !el || el.closest('[aria-hidden="true"]:not(.ui-hold__label--on), .ui-sr, style, script')) continue;
          const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
          if (!r.width || !r.height || cs.visibility === 'hidden' || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
          let z = 1; for (let a = el; a; a = a.parentElement) z *= parseFloat(getComputedStyle(a).zoom || '1') || 1;
          out.push({ px: Math.round(parseFloat(cs.fontSize) * z * 10) / 10, text: text.slice(0, 40) });
        }
        return out.sort((a, b) => a.px - b.px).slice(0, 3);
      });
      const min = small[0]?.px ?? Infinity;   /* a frame with no text (an establishing shot drawn in bars) passes */
      console.log((min >= 28 ? 'ok   ' : 'SMALL') + ' ' + name + ': smallest text ' + (min === Infinity ? 'none' : min + 'px') + ' ' + JSON.stringify(small.map((x) => x.px + ' ' + x.text)));
      if (min < 28) process.exitCode = 1;
    }
    const file = join(out, name + (scale === 1 ? '' : '@' + scale + 'x') + '.png');
    await page.locator('.stage').screenshot({ path: file, animations: 'allow' });
    console.log('wrote ' + file);
    await ctx.close();
  }
} finally {
  await browser.close();
  if (server) server.kill();
}
