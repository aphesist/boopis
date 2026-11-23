// Records an onboarding clip frame by frame on a virtual clock and pipes the frames straight into ffmpeg (no frames on disk).
// node rec.cjs <clip> <out.mp4> [strip.jpg] [reduced]
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const [clip, out, strip, reduced] = process.argv.slice(2);
const FPS = 30, W = 1440, H = 900;
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
  const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => console.error('PAGEERR', e.message));
  await pg.addInitScript(CLOCK);
  await pg.goto('file://' + path.resolve(__dirname, 'motion.html') + '?clip=' + clip + (reduced ? '&reduced=1' : ''));
  await pg.evaluate(() => document.fonts.ready);
  const dur = await pg.evaluate((c) => { window.CLIP = window.CLIPS[c](); window.__step(16); return window.CLIP.dur; }, clip);
  const N = Math.round((dur / 1000) * FPS);
  const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-vf', 'scale=1280:800:flags=lanczos', '-c:v', 'libx264', '-preset', 'slow', '-crf', '22', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const want = strip ? JSON.parse(process.env.STRIP_T || '[]') : [];
  const shots = [];
  for (let f = 0; f < N; f++) {
    const t = (f * 1000) / FPS;
    await pg.evaluate((t) => { window.__step(1000 / 30); window.CLIP.at(t); }, t);
    const buf = await pg.screenshot({ type: 'jpeg', quality: 92 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    for (const w of want) if (Math.abs(w - t) < 1000 / FPS / 2) shots.push([w, buf]);
  }
  ff.stdin.end(); await new Promise((r) => ff.on('close', r));
  if (strip && shots.length) {
    const tiles = shots.map(([w, buf]) => ({ w, b64: buf.toString('base64') }));
    const sp = await ctx.newPage();
    await sp.setViewportSize({ width: 1600, height: 400 });
    await sp.setContent(`<body style="margin:0;background:#0a0a0a;font-family:monospace;color:#9a9a9a"><div id="s" style="display:grid;grid-template-columns:repeat(${Math.min(5, tiles.length)},304px);gap:12px;padding:16px">${tiles.map((x) => `<div><img src="data:image/jpeg;base64,${x.b64}" style="width:304px;display:block;border-radius:6px;box-shadow:0 0 0 1px #2a2a2a"><div style="font-size:11px;margin-top:4px">${(x.w / 1000).toFixed(2)} s</div></div>`).join('')}</div></body>`);
    const el = await sp.$('#s'); await el.screenshot({ path: strip, type: 'jpeg', quality: 88 });
  }
  await b.close();
  console.log('ok', out, N, 'frames');
})();
