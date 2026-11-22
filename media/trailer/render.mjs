/* Renders the trailer frame by frame: the page's clock is virtual (performance.now, Date, requestAnimationFrame, timers
   and every Web Animation follow it), so each frame is a function of its time and nothing depends on how fast the
   machine is. Frames go straight from Chromium into ffmpeg's stdin; none is written to disk.

     node render.mjs [--preview] [--fps 60] [--from 0] [--to <end>] [--out file.mp4] [--audio score.wav]
     node render.mjs --stills 7.5,18,33 --outdir dir     style frames as PNGs (the page still runs every frame before them)
     node render.mjs --no-build ...                      reuse the last build
     node render.mjs --vertical ...                      the 1080x1920 cut

   Uses the preinstalled Playwright (NODE_PATH) and its Chromium; never `playwright install`. */
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const HERE = dirname(fileURLToPath(import.meta.url));
const UI = resolve(HERE, '../../apps/desktop/ui');

const args = process.argv.slice(2);
const flag = (n) => args.includes('--' + n);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const preview = flag('preview');
const FPS = +opt('fps', preview ? 30 : 60);
const SCALE = +opt('scale', preview ? 0.5 : 1);
const BUILD = resolve(opt('build', process.env.TRAILER_OUT || join(HERE, 'build')));
const VERT = flag('vertical');
const stills = opt('stills', '') ? opt('stills').split(',').map(Number).sort((a, b) => a - b) : null;

/* 1. build the page with the desktop UI's own Vite */
if (!flag('no-build')) {
  execFileSync(process.execPath, [join(UI, 'node_modules/vite/bin/vite.js'), 'build', '--config', join(HERE, 'vite.config.mjs')], { stdio: 'inherit', env: { ...process.env, TRAILER_OUT: BUILD } });
}

/* 2. serve it */
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png' };
const server = createServer((req, res) => {
  let file = normalize(join(BUILD, decodeURIComponent((req.url || '/').split('?')[0])));
  if (!file.startsWith(BUILD)) { res.writeHead(403); res.end(); return; }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const origin = 'http://127.0.0.1:' + server.address().port;

/* 3. the virtual clock, installed before any page script runs */
const CLOCK = () => {
  let now = 0;
  const EPOCH = Date.UTC(2026, 10, 22, 14, 9, 0);
  const RealDate = Date;
  class VDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(EPOCH + now); } static now() { return EPOCH + now; } }
  window.Date = VDate;
  performance.now = () => now;
  let rafId = 0, raf = new Map();
  window.requestAnimationFrame = (cb) => { raf.set(++rafId, cb); return rafId; };
  window.cancelAnimationFrame = (id) => { raf.delete(id); };
  let tid = 0; const timers = new Map();
  window.setTimeout = (fn, ms, ...a) => { const id = ++tid; timers.set(id, { at: now + Math.max(0, +ms || 0), fn, a, every: 0 }); return id; };
  window.setInterval = (fn, ms, ...a) => { const id = ++tid; const e = Math.max(1, +ms || 0); timers.set(id, { at: now + e, fn, a, every: e }); return id; };
  window.clearTimeout = window.clearInterval = (id) => { timers.delete(id); };
  let seed = 0x2f6e2b1;
  Math.random = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const tracked = new WeakMap();
  function syncAnimations() {
    for (const a of document.getAnimations()) {
      let s = tracked.get(a);
      if (s == null) { s = now; tracked.set(a, s); try { a.pause(); } catch { /* gone */ } }
      const timing = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : null;
      const end = timing ? timing.endTime : Infinity;
      const ct = (now - s) * (a.playbackRate || 1);
      try {
        if (Number.isFinite(end) && ct >= end) { a.currentTime = end; a.finish(); }
        else a.currentTime = Math.max(0, ct);
      } catch { /* an animation that cannot be seeked */ }
    }
  }
  window.__clock = {
    get now() { return now; },
    advanceTo(target) {
      for (;;) {
        let best = null;
        for (const [id, x] of timers) if (x.at <= target && (!best || x.at < best[1].at || (x.at === best[1].at && id < best[0]))) best = [id, x];
        if (!best) break;
        const [id, x] = best;
        now = Math.max(now, x.at);
        if (x.every) x.at += x.every; else timers.delete(id);
        try { if (typeof x.fn === 'function') x.fn(...x.a); } catch (e) { console.error(e); }
      }
      now = target;
      const q = raf; raf = new Map();
      for (const cb of q.values()) { try { cb(now); } catch (e) { console.error(e); } }
      syncAnimations();
    }
  };
};

const browser = await chromium.launch({ args: ['--force-color-profile=srgb', '--hide-scrollbars', '--disable-features=PaintHolding'] });
const ctx = await browser.newContext({ viewport: VERT ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 }, deviceScaleFactor: SCALE, reducedMotion: 'no-preference' });
await ctx.addInitScript(CLOCK);
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.error('[page]', m.text()); });
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
await page.goto(origin + '/index.html' + (VERT ? '?v=1' : opt('query') ? '?' + opt('query') : ''));
await page.waitForFunction(() => window.__trailer);
await page.evaluate(() => window.__trailer.ready);
const DURATION = await page.evaluate(() => window.__trailer.duration);
const FROM = +opt('from', 0), TO = Math.min(+opt('to', DURATION), DURATION);
const cdp = await ctx.newCDPSession(page);

const step = (t) => page.evaluate((t) => { window.__trailer.frame(t); window.__clock.advanceTo(t * 1000); }, t);
const shot = async (fmt) => Buffer.from((await cdp.send('Page.captureScreenshot', { format: fmt, ...(fmt === 'jpeg' ? { quality: 92 } : {}), optimizeForSpeed: true, fromSurface: true })).data, 'base64');

const total = Math.round(TO * FPS);
const t0 = Date.now();
if (opt('cues', null)) {
  /* the sound cues every scene declares, for the score: run the whole timeline without capturing */
  for (let i = 0; i <= total; i++) await step(i / FPS);
  const cues = await page.evaluate(() => window.__sfx);
  cues.sort((a, b) => a.at - b.at);
  writeFileSync(resolve(opt('cues')), JSON.stringify({ duration: DURATION, cues }, null, 0));
  console.log('wrote', opt('cues'), cues.length, 'cues');
} else if (stills) {
  const outdir = resolve(opt('outdir', join(HERE, 'stills')));
  mkdirSync(outdir, { recursive: true });
  let k = 0;
  for (let i = 0; i <= total && k < stills.length; i++) {
    const t = i / FPS;
    await step(t);
    while (k < stills.length && stills[k] <= t + 1e-9) {
      const f = join(outdir, 'still-' + String(stills[k].toFixed(2)).padStart(6, '0') + '.png');
      writeFileSync(f, await shot('png'));
      console.log('wrote', f);
      k++;
    }
  }
} else {
  const out = resolve(opt('out', join(HERE, preview ? 'preview.mp4' : 'trailer.mp4')));
  const audio = opt('audio', null);
  const fmt = opt('format', preview ? 'jpeg' : 'png');
  const ff = ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', fmt === 'png' ? 'png' : 'mjpeg', '-i', '-'];
  if (audio) ff.push('-ss', String(FROM), '-i', audio);
  ff.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', preview ? 'veryfast' : 'slow', '-crf', preview ? '23' : String(opt('crf', '14')), '-tune', 'animation', '-movflags', '+faststart', '-r', String(FPS));
  if (audio) ff.push('-c:a', 'aac', '-b:a', '256k', '-shortest');
  ff.push(out);
  const proc = spawn('ffmpeg', ff, { stdio: ['pipe', 'inherit', 'inherit'] });
  const write = (buf) => new Promise((ok) => { if (proc.stdin.write(buf)) ok(); else proc.stdin.once('drain', ok); });
  const first = Math.round(FROM * FPS);
  /* the page runs every frame from 0, so a partial render still starts from the right state */
  for (let i = 0; i < total; i++) {
    const t = i / FPS;
    await step(t);
    if (i < first) continue;
    await write(await shot(fmt));
    if (i % (FPS * 2) === 0) process.stdout.write(`\r${t.toFixed(1)}s / ${TO}s  ${((Date.now() - t0) / 1000).toFixed(0)}s elapsed   `);
  }
  proc.stdin.end();
  await new Promise((ok) => proc.on('close', ok));
  console.log('\nwrote', out, ((Date.now() - t0) / 1000).toFixed(1) + 's');
}
await browser.close();
server.close();
