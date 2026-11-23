/* Render the style frames to PNG with the preinstalled Playwright and the look's own vite server.

     node media/launch/look/render.mjs [--scale 1|2] [--out <dir>] [--url <running server>] [--dir frames|board] [--check] [page ...]

   --dir board renders the storyboard's key frames (board/<beat>.html and <beat>-vertical.html) instead of the style frames.
   --scale 2 renders the owner's copies (3840x2160 for 16:9, 2160x3840 for 9:16, laid out at 1080p); 1 is for checking.
   With no frame names it renders every page in frames/ except the calibration pages (zz-*). Without --url it starts vite
   from apps/desktop/ui (where it is installed) and stops it when done. --check also measures each frame and fails it on:
     the text floor   any visible text under 28px at 1080p (font size times every zoom above it)
     the safe area    readable text cut by the frame's edge, or outside the safe box (16:9: x 60 to 1860, y 60 to 1020;
                      9:16: x 60 to 960, clear of the platforms' right rail, and y 220 to 1640); text behind a blur is
                      out of focus and not read, so it is left out
     inline chips     a mention chip whose name does not sit on its line's baseline as the product sets it (the same
                      markup with the kit's own orbs, measured beside it); more than 0.75px apart at real size fails
   and prints, for 9:16, how far down the frame its readable content reaches (look.md section 7: at least y 1450). */
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
      const geo = await page.evaluate((vert) => {
        const W = vert ? 1080 : 1920, H = vert ? 1920 : 1080;
        const box = vert ? { l: 60, r: 960, t: 220, b: 1640 } : { l: 60, r: 1860, t: 60, b: 1020 };
        const stage = document.querySelector('.stage'), sr = stage.getBoundingClientRect(), k = sr.width / W;
        const blurred = (el) => { for (let a = el; a && a !== stage; a = a.parentElement) { const cs = getComputedStyle(a); if (/blur\(/.test(cs.filter) && !/blur\(0/.test(cs.filter)) return true; if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') return true; } return false; };
        const bad = [];
        let lowest = 0;
        const walk = document.createTreeWalker(stage, NodeFilter.SHOW_TEXT);
        for (let n = walk.nextNode(); n; n = walk.nextNode()) {
          const text = n.textContent.trim(), el = n.parentElement;
          if (!text || !el || el.closest('[aria-hidden="true"]:not(.ui-hold__label--on), .ui-sr, style, script') || blurred(el)) continue;
          const rg = document.createRange(); rg.selectNodeContents(n);
          for (const q of rg.getClientRects()) {
            if (!q.width || !q.height) continue;
            const r = { l: (q.left - sr.left) / k, r: (q.right - sr.left) / k, t: (q.top - sr.top) / k, b: (q.bottom - sr.top) / k };
            if (r.r <= 0 || r.l >= W || r.b <= 0 || r.t >= H) continue;   /* wholly off the frame: not on screen */
            lowest = Math.max(lowest, Math.min(H, r.b));
            const cut = r.l < 0 || r.r > W || r.t < 0 || r.b > H;
            if (cut || r.l < box.l - 0.5 || r.r > box.r + 0.5 || r.t < box.t - 0.5 || r.b > box.b + 0.5) bad.push((cut ? 'cut ' : 'unsafe ') + '"' + text.slice(0, 28) + '" ' + [r.l, r.t, r.r, r.b].map((v) => Math.round(v)).join(','));
          }
        }
        /* mention chips: the film's baseline against the product's, the same markup with the kit's orbs at their own size */
        const zoomOf = (e) => { let z = 1; for (; e; e = e.parentElement) { const v = parseFloat(getComputedStyle(e).zoom || '1'); if (v && v !== 1) z *= v; } return z; };
        const base = (where) => { const s = document.createElement('span'); s.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline'; where(s); const y = s.getBoundingClientRect().bottom; s.remove(); return y; };
        const delta = (chip) => {
          const name = chip.querySelector('.ui-mention__name') || chip;
          let nx = chip.nextSibling; while (nx && !(nx.nodeType === 3 && nx.textContent.trim())) nx = nx.nextSibling;
          const prev = chip.previousSibling && chip.previousSibling.nodeType === 3 && chip.previousSibling.textContent.trim() ? chip.previousSibling : null;
          const ref = nx ?? prev; if (!ref) return null;
          const yc = base((s) => name.appendChild(s));
          const yt = base((s) => (ref === nx ? ref.parentNode.insertBefore(s, ref) : ref.parentNode.insertBefore(s, ref.nextSibling)));
          const chipTop = chip.getBoundingClientRect().top, tr = document.createRange(); tr.selectNodeContents(ref); const rt = tr.getClientRects();
          const refRect = ref === nx ? rt[0] : rt[rt.length - 1];
          if (refRect && Math.abs(refRect.top - chipTop) > chip.getBoundingClientRect().height) return null;   /* wrapped to another line */
          return (yc - yt) / zoomOf(chip);
        };
        const chips = [];
        for (const chip of stage.querySelectorAll('.ui-mention')) {
          if (!chip.getBoundingClientRect().width || blurred(chip)) continue;
          const film = delta(chip); if (film === null) continue;
          const par = chip.parentElement, clone = par.cloneNode(true);
          for (const a of clone.querySelectorAll('orb-avatar')) { const z = parseFloat(a.style.zoom || '1'); if (z !== 1) { a.setAttribute('size', String(Math.round(Number(a.getAttribute('size')) * z))); a.style.zoom = ''; } }
          const host = document.createElement('div'); host.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;width:' + (par.getBoundingClientRect().width / zoomOf(par)) + 'px';
          host.append(clone); (chip.closest('.ui-film') || stage).append(host);
          const twin = clone.querySelectorAll('.ui-mention')[[...par.querySelectorAll('.ui-mention')].indexOf(chip)];
          const prod = twin ? delta(twin) : null; host.remove();
          if (prod === null) continue;
          chips.push({ name: (chip.textContent || '').trim(), film: +film.toFixed(2), prod: +prod.toFixed(2) });
        }
        return { bad, lowest: Math.round(lowest), chips };
      }, vertical);
      const chipBad = geo.chips.filter((c) => Math.abs(c.film - c.prod) > 0.75);
      console.log((geo.bad.length || chipBad.length ? 'FRAME' : 'ok   ') + ' ' + name + ': safe area ' + (geo.bad.length ? geo.bad.length + ' ' + JSON.stringify(geo.bad.slice(0, 6)) : 'clear') +
        '; chips ' + (geo.chips.length ? JSON.stringify(geo.chips.map((c) => c.name + ' ' + c.film + '/' + c.prod)) : 'none') + (vertical ? '; content reaches y ' + geo.lowest : ''));
      if (geo.bad.length || chipBad.length) process.exitCode = 1;
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
