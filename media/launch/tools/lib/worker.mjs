/* One render worker: its own Chromium, one contiguous range of frames, its own ffmpeg segment.
   For each frame it asks the page whether anything moves under the shutter; if so it renders `samples` sub-frames
   spread over the shutter (centred on the frame's time, never across a hard cut) and averages them in linear light;
   if not, one capture. Frames are captured as PNG with Chrome's fast encoder (lossless), decoded here and piped raw
   into ffmpeg. Started by tools/render.mjs with a JSON job in argv[2]. */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { decodePNG } from './png.mjs';
import { encoder } from './encode.mjs';
import { grainer } from './grain.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const job = JSON.parse(process.argv[2]);
const send = (m) => { if (process.send && process.connected) process.send(m); };

export const CHROME_ARGS = ['--force-color-profile=srgb', '--font-render-hinting=none', '--disable-lcd-text', '--hide-scrollbars', '--disable-threaded-animation', '--disable-checker-imaging'];

/* sRGB <-> linear light */
const TO_LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) { const x = i / 255; TO_LIN[i] = x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }
const LUT_N = 8192;
const TO_SRGB = new Uint8Array(LUT_N + 1);
for (let i = 0; i <= LUT_N; i++) { const x = i / LUT_N; TO_SRGB[i] = Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055)); }

/** the times of a frame's sub-samples: the shutter is centred on the frame's time and clamped to its side of any cut */
export function sampleTimes(T, n, shutter, fps, duration, cuts) {
  if (n <= 1) return [T];
  const D = (shutter / 360) / fps;
  let lo = T - D / 2, hi = T + D / 2;
  for (const c of cuts) {
    if (c > lo && c <= T) lo = c;            /* a cut just before: start at it */
    if (c > T && c < hi) hi = c - 1e-6;      /* a cut just after: stop short of it */
  }
  lo = Math.max(0, lo); hi = Math.min(duration, hi);
  const out = [];
  for (let i = 0; i < n; i++) out.push(lo + ((i + 0.5) / n) * (hi - lo));
  return out;
}

/* a frame whose shutter ends differ in fewer than this share of pixels (by more than 40 levels) is moving slowly */
const SLOW = 0.002;
function changed(a, b) {
  let n = 0, m = 0;
  for (let i = 0; i < a.length; i += 3 * 7) { m++; if (Math.abs(a[i] - b[i]) > 40 || Math.abs(a[i + 1] - b[i + 1]) > 40) n++; }
  return n / m;
}

async function main() {
  const { url, f0, f1, width, height, scale, fps, samples, shutter, codec, out, preview, crf, hashes, still } = job;
  const W = Math.round(width * scale), H = Math.round(height * scale);
  const browser = await chromium.launch({ args: CHROME_ARGS });
  /* 4K is the same layout at deviceScaleFactor 2; a preview below 1 is captured with a scaled clip */
  const dsf = scale >= 1 ? scale : 1;
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dsf, reducedMotion: 'no-preference', colorScheme: 'dark' });
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());   /* nothing leaves loopback */
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url + '&nograin', { waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.dataset.filmReady, null, { timeout: 60000 });
  const err = await page.evaluate(() => window.__filmError || null);
  if (err) throw new Error('page failed: ' + err);
  const meta = await page.evaluate(() => ({ duration: window.__film.duration, cuts: window.__film.cuts, grain: window.__film.grain }));
  const addGrain = meta.grain ? grainer(meta.grain, scale) : null;
  const cdp = await context.newCDPSession(page);
  const capture = async () => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true, fromSurface: true, captureBeyondViewport: false, ...(scale < 1 ? { clip: { x: 0, y: 0, width, height, scale } } : {}) });
    const img = decodePNG(Buffer.from(r.data, 'base64'));
    if (img.width !== W || img.height !== H) throw new Error('capture is ' + img.width + 'x' + img.height + ', expected ' + W + 'x' + H);
    return img.rgb;
  };
  /* how many sub-frames each frame asks for (0: nothing moves; -1: the default; n: a fast move wants n), one call */
  const D = (shutter / 360) / fps;
  const asks = samples > 1 ? await page.evaluate(([a, b, fps, D]) => { const o = []; for (let k = a; k < b; k++) o.push(window.__film.samples(k / fps - D / 2, k / fps + D / 2)); return o; }, [f0, f1, fps, D]) : [];

  const enc = encoder(codec, { width: W, height: H, fps, out, preview, crf, threads: job.threads });
  const acc = samples > 1 ? new Float32Array(W * H * 3) : null;
  const frame = Buffer.allocUnsafe(W * H * 3);
  const hashList = [];
  let renders = 0;
  const t0 = Date.now();
  const shoot = async (t) => { await page.evaluate((t) => window.__film.seek(t, { paint: false }), t); renders++; return capture(); };
  const add = (s) => { for (let i = 0; i < s.length; i++) acc[i] += TO_LIN[s[i]]; };
  for (let k = f0; k < f1; k++) {
    const T = k / fps;
    const ask = samples > 1 ? asks[k - f0] : 0;
    /* an explicit ask scales with --samples (a draft at 4 halves a whip's 32) */
    const n = ask === 0 ? 1 : ask > 0 ? Math.min(64, Math.max(samples, Math.round((ask * samples) / 8))) : samples;
    const times = sampleTimes(T, n, shutter, fps, meta.duration, meta.cuts);
    let rgb;
    if (times.length === 1) {
      rgb = await shoot(times[0]);
    } else {
      acc.fill(0);
      /* the shutter's two ends first: when they barely differ (a slow glance, a drift) the motion is under a pixel or
         two across the shutter and their average is the blur; otherwise every sub-frame */
      const a = await shoot(times[0]), b = await shoot(times[times.length - 1]);
      add(a); add(b);
      let used = 2;
      if (ask !== -1 || changed(a, b) > SLOW) { for (const t of times.slice(1, -1)) add(await shoot(t)); used = times.length; }
      const inv = LUT_N / used;
      for (let i = 0; i < frame.length; i++) frame[i] = TO_SRGB[Math.min(LUT_N, Math.round(acc[i] * inv))];
      rgb = frame;
    }
    if (addGrain) { if (rgb !== frame) { rgb.copy(frame); rgb = frame; } addGrain(rgb, W, H, k); }
    if (hashes) hashList.push(createHash('md5').update(rgb).digest('hex'));
    await enc.write(rgb);
    if ((k - f0) % 10 === 9 || k === f1 - 1) send({ type: 'progress', done: k - f0 + 1, renders, ms: Date.now() - t0 });
    if (still) break;
  }
  await enc.end();
  await browser.close();
  send({ type: 'done', frames: f1 - f0, renders, ms: Date.now() - t0, hashes: hashList, errors });
}

main().catch((e) => { send({ type: 'error', message: e.stack || String(e) }); process.exitCode = 1; setTimeout(() => process.exit(1), 100); });
