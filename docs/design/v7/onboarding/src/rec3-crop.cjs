// Revision 3 (revision 2's recorder on ob3-motion.html): 60 fps. Records an onboarding clip frame by frame on a virtual clock and pipes the frames straight into ffmpeg (no frames on disk).
// Revision 3, the eye check's 2x frames: node rec3-crop.cjs <clip> <outDir> <x,y,w,h page px> <f0> <f1> [reduced]: the region of
// each frame in [f0, f1] at DPR 2 as JPEGs plus eyecheck's rects.json (for bots too small to measure in the 1280 MP4)
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const [clip, out, reg, F0, F1, reduced] = process.argv.slice(2); const fs = require('fs'); const [rx, ry, rw, rh] = reg.split(',').map(Number);
const FPS = 60, W = 1440, H = 900;
const CLOCK = `(() => {
  let now = 0; const T0 = 1700000000000; let seed = 20261123;
  Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const raf = new Map(); let rid = 0; const timers = new Map(); let tid = 0;
  performance.now = () => now; Date.now = () => T0 + now;
  window.requestAnimationFrame = (cb) => { raf.set(++rid, cb); return rid; };
  window.cancelAnimationFrame = (id) => raf.delete(id);
  window.setTimeout = (cb, ms = 0, ...a) => { timers.set(++tid, { at: now + Math.max(0, +ms || 0), cb, a }); return tid; };
  window.clearTimeout = (id) => timers.delete(id);
  window.setInterval = (cb, ms = 0, ...a) => { const id = ++tid; const run = () => { cb(...a); timers.set(id, { at: now + Math.max(1, +ms || 1), cb: run, a: [] }); }; timers.set(id, { at: now + Math.max(1, +ms || 1), cb: run, a: [] }); return id; };
  window.clearInterval = (id) => timers.delete(id);
  window.__step = (dt) => {
    const end = now + dt;
    for (;;) { let next = null; for (const [id, t] of timers) if (t.at <= end && (!next || t.at < next[1].at)) next = [id, t]; if (!next) break; now = Math.max(now, next[1].at); timers.delete(next[0]); try { next[1].cb(...next[1].a); } catch (e) { console.error(e); } }
    now = end; const q = [...raf.entries()]; raf.clear(); for (const [, cb] of q) { try { cb(now); } catch (e) { console.error(e); } }
  };
})();`;
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => console.error('PAGEERR', e.message));
  await pg.addInitScript(CLOCK);
  await pg.goto('file://' + path.resolve(__dirname, 'ob3-motion.html') + '?clip=' + clip + (reduced ? '&reduced=1' : ''));
  await pg.evaluate(() => document.fonts.ready);
  const dur = await pg.evaluate((c) => { window.CLIP = window.CLIPS[c](); window.__step(16); return window.CLIP.dur; }, clip);
  /* revision 3: a pre-roll of 30 frames at t = 0 before recording, so orb2's own mount animation (a new orb eases from a circle
     into its shape over its first ten frames) has settled before the clip's first frame */
  await pg.evaluate(() => { for (let i = 0; i < 30; i++) { window.__step(1000 / 60); window.CLIP.at(0); } });
  const N = Math.round((dur / 1000) * FPS);
  fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(out + '/rects.json', JSON.stringify({ dpr: 2, rects: [{ x: 0, y: 0, w: rw, h: rh, half: 1, bot: clip, shape: clip }] }));
  for (let f = 0; f <= +F1; f++) {
    const t = (f * 1000) / FPS;
    await pg.evaluate((t) => { window.__step(1000 / 60); window.CLIP.at(t); }, t);
    if (f >= +F0) await pg.screenshot({ path: `${out}/${String(f - +F0).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 95, clip: { x: rx, y: ry, width: rw, height: rh } });
  }
  await b.close();
  console.log('ok', out);
})();
