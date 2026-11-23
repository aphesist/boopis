/* One render worker: its own Chromium, one contiguous range of frames, its own ffmpeg segment.

   Motion blur is planned per frame from the motion itself (plan() below): the page measures the largest on-screen
   displacement of anything visible across the frame's shutter (src/engine/probe.ts), and the frame gets as many
   sub-frames as it takes for neighbouring sub-frames to sit at most `spacing` output px apart (1 by default, at the
   output's own scale, so 4K takes twice the samples of 1080p for the same move). A frame where nothing moves more than
   that across the shutter is one capture. Above `maxSamples` the shutter closes down instead (a shorter streak, still
   continuous), so a frame is a smooth blur or a sharp still and never two or three discrete copies. The planned
   sub-frames are then measured again and the count raised if any neighbouring pair is still too far apart; the worst
   spacing of every frame is reported, and the renderer fails if any exceeds the limit.

   Sub-frames are spread over the shutter, centred on the frame's time, never across a hard cut, averaged in linear
   light. Frames are captured as PNG with Chrome's fast encoder (lossless), decoded here and piped raw into ffmpeg.
   Started by tools/render.mjs with a JSON job in argv[2]. */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { decodePNG } from './png.mjs';
import { encoder } from './encode.mjs';
import { grainer } from './grain.mjs';
import { CHROME_ARGS } from './build.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const job = JSON.parse(process.argv[2]);
const send = (m) => { try { if (process.send && process.connected) process.send(m); } catch { /* the parent is gone */ } };
let finished = false;
/* the renderer stopped (another worker failed): stop too. (This listener keeps the IPC channel open, so a finished
   worker disconnects itself, below.) */
process.on('disconnect', () => process.exit(finished ? 0 : 1));


/* sRGB <-> linear light */
const TO_LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) { const x = i / 255; TO_LIN[i] = x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }
const LUT_N = 8192;
const TO_SRGB = new Uint8Array(LUT_N + 1);
for (let i = 0; i <= LUT_N; i++) { const x = i / LUT_N; TO_SRGB[i] = Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055)); }

/** the shutter window of frame time T: `angle` degrees centred on T, clamped to its side of any hard cut */
export function shutterWindow(T, angle, fps, duration, cuts) {
  const D = (angle / 360) / fps;
  let lo = T - D / 2, hi = T + D / 2;
  for (const c of cuts) {
    if (c > lo && c <= T) lo = c;            /* a cut just before: start at it */
    if (c > T && c < hi) hi = c - 1e-6;      /* a cut just after: stop short of it */
  }
  return [Math.max(0, lo), Math.min(duration, hi)];
}
/** n sub-frame times, each at the middle of its 1/n of the window */
export function sampleTimes(lo, hi, n) {
  if (n <= 1) return [(lo + hi) / 2];
  const out = [];
  for (let i = 0; i < n; i++) out.push(lo + ((i + 0.5) / n) * (hi - lo));
  return out;
}

const PROBES = 5;   /* points across the shutter for the first measure of speed */

/** a discontinuity inside [a, b]: bisect while one half keeps nearly all of the displacement (a move spreads over
    both halves; a jump stays in one, down to a few microseconds). Returns { lo, hi, size } or null */
async function findJump(measure, a, b, d, scale) {
  let lo = a, hi = b;
  for (let i = 0; i < 10; i++) {
    const m = (lo + hi) / 2, s = (await measure([lo, m, hi])).steps.map((x) => x * scale);
    if (s[0] >= 0.8 * d) { hi = m; d = s[0]; } else if (s[1] >= 0.8 * d) { lo = m; d = s[1]; } else return null;
  }
  return { lo, hi, size: d };
}

/** the frame's sub-frames: { times, n, angle, worst (output px between neighbouring sub-frames), moved (output px
    across the full shutter at the peak speed), what, jumps (discontinuities the shutter was kept off) }.
    A jump (something that changes in an instant: a cut the scene did not declare, a pose set in one go) cannot be
    blurred: averaging both sides of it is exactly a double image. The shutter is kept on the frame's side of it, as at
    a declared cut, and the jump is reported. */
export async function plan(page, T, o) {
  const { fps, duration, cuts, scale, shutter, spacing, maxSamples, fixed } = o;
  const measure = async (times) => page.evaluate((ts) => window.__film.probe(ts), times);
  const jumps = [];
  let fence = [-Infinity, Infinity];                 /* the shutter stays inside: the jumps found so far */
  const win = (angle) => { const [a, b] = shutterWindow(T, angle, fps, duration, cuts); return [Math.max(a, fence[0]), Math.min(b, fence[1])]; };
  const still = (moved, what) => ({ times: [T], n: 1, angle: 0, worst: 0, moved, what, jumps });
  if (shutter <= 0) return still(0, '');
  for (let attempt = 0; attempt < 4; attempt++) {
    let [lo, hi] = win(shutter);
    if (hi - lo <= 1e-6) return still(0, '');
    const ts = Array.from({ length: PROBES }, (_, i) => lo + (i / (PROBES - 1)) * (hi - lo));
    const first = await measure(ts);
    const steps = first.steps.map((x) => x * scale);
    /* a step far above the others may be a jump: look closer before trusting it as speed */
    const sorted = [...steps].sort((a, b) => a - b), typical = sorted[Math.floor(sorted.length / 2)] ?? 0;
    let fenced = false;
    for (let i = 0; i < steps.length && !fenced; i++) {
      if (steps[i] <= Math.max(2 * spacing, 2.5 * typical)) continue;
      const j = await findJump(measure, ts[i], ts[i + 1], steps[i], scale);
      if (!j) continue;
      jumps.push({ t: Math.round(((j.lo + j.hi) / 2) * 1e6) / 1e6, size: Math.round(j.size * 10) / 10, what: first.fastest });
      if (j.hi <= T) fence = [Math.max(fence[0], j.hi), fence[1]]; else fence = [fence[0], Math.min(fence[1], j.lo)];
      fenced = true;
    }
    if (fenced) continue;                            /* plan again inside the fence */
    const moved = Math.max(0, ...steps) * (PROBES - 1);   /* across the window at its peak speed */
    if (fixed) {                                     /* a forced count (the self-test's negative control) */
      if (moved <= spacing) return still(moved, first.fastest);
      const times = sampleTimes(lo, hi, fixed);
      const v = fixed > 1 ? await measure(times) : { steps: [moved] };
      return { times, n: fixed, angle: shutter, worst: Math.max(0, ...v.steps) * scale, moved, what: first.fastest, jumps };
    }
    /* sub-frames at the middle of n equal slices sit moved / n apart: n = moved / spacing; one when that is under one */
    let n = Math.ceil(moved / spacing - 1e-9), angle = shutter;
    if (n <= 1) return still(moved, first.fastest);
    if (n > maxSamples) { angle = shutter * (maxSamples * spacing) / moved; n = maxSamples; [lo, hi] = win(angle); }
    let times = sampleTimes(lo, hi, n), worst = 0;
    for (let pass = 0; pass < 5; pass++) {
      const v = await measure(times), vs = v.steps.map((x) => x * scale);
      worst = Math.max(0, ...vs);
      if (worst <= spacing * 1.05) break;
      /* a neighbouring pair still too far apart: a jump between them, or uneven motion inside the shutter (a step under
         two spacings that will not shrink is layout snapping to the pixel grid: not a copy, accepted) */
      const at = vs.indexOf(worst), j = worst > 2 * spacing ? await findJump(measure, times[at], times[at + 1], worst, scale) : null;
      if (j) { jumps.push({ t: Math.round(((j.lo + j.hi) / 2) * 1e6) / 1e6, size: Math.round(j.size * 10) / 10, what: v.fastest }); if (j.hi <= T) fence = [Math.max(fence[0], j.hi), fence[1]]; else fence = [fence[0], Math.min(fence[1], j.lo)]; break; }
      if (worst <= 2 * spacing && pass > 0) break;
      const want = Math.ceil(n * worst / spacing);
      if (want <= maxSamples) n = want; else { angle = angle * (maxSamples / want); n = maxSamples; [lo, hi] = win(angle); }
      times = sampleTimes(lo, hi, n);
    }
    if (jumps.length && worst > spacing * 1.05 && attempt < 3) continue;   /* a jump was fenced off: plan again */
    return { times, n, angle, worst, moved, what: first.fastest, jumps };
  }
  return still(0, '');
}

async function main() {
  const { url, f0, f1, width, height, scale, fps, samples, shutter, codec, out, preview, crf, hashes, still } = job;
  const spacing = job.spacing ?? 1, maxSamples = job.maxSamples ?? 96, planOnly = !!job.planOnly;
  const W = Math.round(width * scale), H = Math.round(height * scale);
  const browser = await chromium.launch({ args: CHROME_ARGS });
  /* 4K is the same layout at deviceScaleFactor 2. Through CDP the capture's size is the clip's scale (without it a
     capture at deviceScaleFactor 2 comes back at 1080p), so any scale but 1 passes one; a preview below 1 too */
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
  /* the shutter stops at cuts and at instant changes (zero-duration tweens): __film.fences (older pages: cuts) */
  const meta = await page.evaluate(() => ({ duration: window.__film.duration, cuts: window.__film.fences ?? window.__film.cuts, grain: window.__film.grain }));
  const addGrain = meta.grain ? grainer(meta.grain, scale, W, H) : null;
  const cdp = await context.newCDPSession(page);
  const capture = async () => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true, fromSurface: true, captureBeyondViewport: false, ...(scale !== 1 ? { clip: { x: 0, y: 0, width, height, scale } } : {}) });
    const img = decodePNG(Buffer.from(r.data, 'base64'));
    if (img.width !== W || img.height !== H) throw new Error('capture is ' + img.width + 'x' + img.height + ', expected ' + W + 'x' + H);
    return img.rgb;
  };
  const enc = planOnly ? null : encoder(codec, { width: W, height: H, fps, out, preview, crf, threads: job.threads });
  const acc = samples > 1 && !planOnly ? new Float32Array(W * H * 3) : null;
  const frame = Buffer.allocUnsafe(planOnly ? 0 : W * H * 3);
  const hashList = [], plans = [];
  let renders = 0;
  const t0 = Date.now();
  const shoot = async (t) => { await page.evaluate((t) => window.__film.seek(t, { paint: false }), t); renders++; return capture(); };
  const add = (s) => { for (let i = 0; i < s.length; i++) acc[i] += TO_LIN[s[i]]; };
  const opts = { fps, duration: meta.duration, cuts: meta.cuts, scale, shutter: samples > 1 ? shutter : 0, spacing, maxSamples, fixed: job.fixedSamples ?? 0 };
  for (let k = f0; k < f1; k++) {
    const T = k / fps;
    const p = await plan(page, T, opts);
    plans.push({ k, n: p.n, angle: Math.round(p.angle * 10) / 10, worst: Math.round(p.worst * 100) / 100, moved: Math.round(p.moved * 10) / 10, what: p.what, ...(p.jumps.length ? { jumps: p.jumps } : {}) });
    if (planOnly) { if ((k - f0) % 10 === 9 || k === f1 - 1) send({ type: 'progress', done: k - f0 + 1, renders, ms: Date.now() - t0 }); continue; }
    let rgb;
    if (p.times.length === 1) {
      rgb = await shoot(p.times[0]);
    } else {
      acc.fill(0);
      for (const t of p.times) add(await shoot(t));
      const inv = LUT_N / p.times.length;
      for (let i = 0; i < frame.length; i++) frame[i] = TO_SRGB[Math.min(LUT_N, Math.round(acc[i] * inv))];
      rgb = frame;
    }
    if (addGrain) { if (rgb !== frame) { rgb.copy(frame); rgb = frame; } addGrain(rgb, W, H, k); }
    if (hashes) hashList.push(createHash('md5').update(rgb).digest('hex'));
    await enc.write(rgb);
    if ((k - f0) % 10 === 9 || k === f1 - 1) send({ type: 'progress', done: k - f0 + 1, renders, ms: Date.now() - t0 });
    if (still) break;
  }
  if (enc) await enc.end();
  await browser.close();
  send({ type: 'done', frames: f1 - f0, renders, ms: Date.now() - t0, hashes: hashList, errors, plans });
  finished = true;
  if (process.connected) process.disconnect();
}

main().catch((e) => { send({ type: 'error', message: e.stack || String(e) }); process.exitCode = 1; setTimeout(() => process.exit(1), 100); });
