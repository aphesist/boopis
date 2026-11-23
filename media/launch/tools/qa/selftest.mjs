#!/usr/bin/env node
/* The checker's own test: short clips made from real frames of the film, with a known answer, run through the same
   detectors qa.mjs uses.

   node tools/qa/selftest.mjs [--renders <dir>] [--dir <dir>] [--only <regex>] [--keep]

     --renders  where the act renders are (default SC/renders): the clips are cut from a1, a3 and a4 frames
     --dir      where the clips go (default a temporary folder, removed after; with --keep it stays and is reused)

   Clips are 1920x1080 at 60 fps, H.264 CRF 14 like the renders, with fresh grain on every frame. Moves are sub-pixel
   resamples of a still frame; motion blur is the average of as many shutter samples (180 deg) as keep neighbouring
   samples within 1.5 px, as the renderer plans it, except the strobe cases, which keep only the shutter's two ends.

     must flag as a cross-fade (8% of the frame or more)
       xfade-4/8/16/30        two different frames of the film, cross-fading over 4, 8, 16, 30 frames
       xfade-16-drift20       a cross-fade while the camera drifts 20 px/s; xfade-30-drift40 at 40 px/s
       xfade-16-zoom2         a cross-fade while the camera zooms 2%/s
       panel-xfade-16         one UI panel (15% of the frame) cross-fading into another, the rest still
     must not flag as a cross-fade
       drift-2/5/10/20/40     a full frame of UI type drifting at that many 1080p px/s; drift-up-20 vertically
       zoom-0.5/1/2/3         a slow push of 0.5 to 3% a second
       panel-drift-10/30      one panel drifting at 10 or 30 px/s over a still frame
       cut                    a hard cut
       whip-blur, move-blur   a fast whip and a quick move, motion-blurred
     must flag as double images
       orb-h-strobe, orb-diag-strobe   an orb flying across, each frame two sharp copies (the shutter's two ends)
     must not flag as double images
       orb-h-smooth, orb-diag-smooth   the same flights smoothly blurred
       list-v-smooth                   a column of list rows and type moving fast along its own repeat, blurred
       whip-blur, move-blur, drift-40  (checked for both)

     the page checks, on a synthetic page with window.__film (layout.mjs, frames.mjs)
       page-text-edge         a line cut by the right edge, a headline 12 px from the top: flagged
       page-text-inside       a line well inside, one masked by its own box, one whipping off the edge: not flagged
       page-act-span-*        act 1's card coming back in act 3, act 3's composer visible from 0 s through a hidden
                              parent: flagged; act 3's card drawn only in act 3, act 1's room carried on: not
       page-chip-*            a capsule 15 px below the line: flagged; the same capsule as set: not
       confirm-*              "renders" of a page with a fast mover from the shutter's two ends, and from 64 samples,
                              compared with a 64-sample re-render: the first confirmed, the second clean
     the act joins (frames.mjs), on four short "acts": a seam that matches, a panel shifted 10 px, a corner changed

   Exit code 1 when any case comes out wrong. */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { crossfades, XF_AREA, probe } from './video.mjs';
import { doubleImages } from './doubles.mjs';
import { SC } from '../lib/build.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); if (i < 0) return d; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const flag = (k) => { const i = argv.indexOf(k); if (i < 0) return false; argv.splice(i, 1); return true; };
const renders = resolve(opt('--renders', join(SC, 'renders'))), only = opt('--only', null), keep = flag('--keep');
const dirArg = opt('--dir', null);
const dir = dirArg ? resolve(dirArg) : mkdtempSync(join(tmpdir(), 'film-qa-selftest-'));
mkdirSync(dir, { recursive: true });

const FFMPEG = process.env.FFMPEG || '/usr/bin/ffmpeg';
const W = 1920, H = 1080, FPS = 60, N = 96;

function frameAt(name, t) {
  const file = join(renders, name);
  if (!existsSync(file)) throw new Error('missing render ' + file + ' (pass --renders <dir>)');
  const buf = execFileSync(FFMPEG, ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', 'scale=' + W + ':' + H + ',format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 64 << 20 });
  return Float32Array.from(buf);
}

/* dst (+)= wgt x src scaled by s about the centre and moved by (tx, ty); bilinear */
function affine(src, dst, s, tx, ty, wgt = 1, acc = false) {
  const cx = W / 2, cy = H / 2, is = 1 / s;
  for (let y = 0; y < H; y++) {
    let sy = (y - cy) * is + cy - ty; sy = Math.min(H - 1.001, Math.max(0, sy));
    const y0 = sy | 0, fy = sy - y0, r0 = y0 * W, r1 = r0 + W;
    for (let x = 0; x < W; x++) {
      let sx = (x - cx) * is + cx - tx; sx = Math.min(W - 1.001, Math.max(0, sx));
      const x0 = sx | 0, fx = sx - x0;
      const v = (src[r0 + x0] * (1 - fx) + src[r0 + x0 + 1] * fx) * (1 - fy) + (src[r1 + x0] * (1 - fx) + src[r1 + x0 + 1] * fx) * fy;
      const i = y * W + x; dst[i] = acc ? dst[i] + v * wgt : v * wgt;
    }
  }
}
/* the rect r of src, moved by (dx, dy), over dst, edges anti-aliased */
function panel(src, dst, [rx, ry, rw, rh], dx, dy) {
  const cov = (p, lo, hi) => Math.max(0, Math.min(1, p + 0.5 - lo, hi - p + 0.5));
  for (let y = Math.max(0, Math.floor(ry + dy) - 1); y <= Math.min(H - 1, Math.ceil(ry + rh + dy) + 1); y++) {
    const sy = y - dy, cy = cov(sy, ry, ry + rh); if (cy <= 0) continue;
    const yi = Math.min(H - 2, Math.max(0, Math.floor(sy))), fy = sy - yi;
    for (let x = Math.max(0, Math.floor(rx + dx) - 1); x <= Math.min(W - 1, Math.ceil(rx + rw + dx) + 1); x++) {
      const sx = x - dx, c = cy * cov(sx, rx, rx + rw); if (c <= 0) continue;
      const xi = Math.min(W - 2, Math.max(0, Math.floor(sx))), fx = sx - xi, o = yi * W + xi;
      const v = (src[o] * (1 - fx) + src[o + 1] * fx) * (1 - fy) + (src[o + W] * (1 - fx) + src[o + W + 1] * fx) * fy;
      dst[y * W + x] = dst[y * W + x] * (1 - c) + v * c;
    }
  }
}

let seed = 1;
const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
async function encode(out, draw, count = N) {
  const p = spawn(FFMPEG, ['-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', W + 'x' + H, '-r', String(FPS), '-i', 'pipe:0', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-pix_fmt', 'yuv420p', '-threads', '2', '-y', out], { stdio: ['pipe', 'ignore', 'pipe'] });
  let err = ''; p.stderr.on('data', (c) => { err += c; });
  const done = new Promise((ok, fail) => p.on('close', (c) => (c ? fail(new Error(err)) : ok())));
  const f = new Float32Array(W * H), b = Buffer.alloc(W * H);
  seed = 12345;
  for (let i = 0; i < count; i++) {
    draw(i / FPS, f, i);
    for (let k = 0; k < f.length; k++) { const v = f[k] + (rnd() - 0.5) * 12; b[k] = v < 0 ? 0 : v > 255 ? 255 : v; }
    if (!p.stdin.write(b)) await new Promise((r) => p.stdin.once('drain', r));
  }
  p.stdin.end(); await done;
}

const encodeFrames = (out, frames) => encode(out, (t, f, i) => f.set(frames[i]), frames.length);

/* the frames: UI type (a3), a terminal and a room (a3), the cast cards (a1), a thread (a4), an orb (a1) */
const UI = frameAt('a3-1080.mp4', 4.5), TERM = frameAt('a3-1080.mp4', 11.5), CAST = frameAt('a1-1080.mp4', 6.0), THREAD = frameAt('a4-1080.mp4', 3.0), ORB = frameAt('a1-1080.mp4', 0.5);
const S0 = 1.06; /* every frame is drawn a little zoomed in, so moves never reach past the source's edge */
const mixBuf = new Float32Array(W * H);
const mix = (a, b, k) => { for (let i = 0; i < mixBuf.length; i++) mixBuf[i] = a[i] + (b[i] - a[i]) * k; return mixBuf; };
const fadeK = (i, at, n) => (i < at ? 0 : i >= at + n ? 1 : (i - at + 1) / (n + 1));
const travel = (p) => (p <= 0 ? 0 : p >= 1 ? 1 : p < 0.5 ? 16 * p ** 5 : 1 - (-2 * p + 2) ** 5 / 2);
const snap = travel;
/* shutter sample times for a frame at t whose fastest point moves `speed` px a frame: every 1.5 px, or the two ends */
const shutter = (t, speed, ends = false) => {
  if (ends) return [t - 0.25 / FPS, t + 0.25 / FPS];
  const n = Math.max(1, Math.min(48, Math.ceil((speed * 0.5) / 1.5)));
  return Array.from({ length: n }, (_, i) => t + ((i + 0.5) / n - 0.5) * (0.5 / FPS));
};
const blurred = (f, t, pos, speedAt, drawAt, ends = false) => {
  const ts = shutter(t, speedAt(t), ends);
  if (ts.length === 1) { drawAt(f, pos(t), 1, false); return; }
  f.fill(0); for (const s of ts) drawAt(f, pos(s), 1 / ts.length, true);
};
const speedOf = (pos) => (t) => { const a = pos(t - 0.5 / FPS), b = pos(t + 0.5 / FPS); return Math.hypot(b[0] - a[0], b[1] - a[1]); };

/* an orb: the disc of ORB around (717, 700), radius 140, moved by (dx, dy), added over UI (unzoomed) */
const OC = [717, 700], OR = 140;
function orb(f, [dx, dy], wgt) {
  for (let y = Math.max(0, Math.floor(OC[1] + dy - OR - 2)); y <= Math.min(H - 1, Math.ceil(OC[1] + dy + OR + 2)); y++) for (let x = Math.max(0, Math.floor(OC[0] + dx - OR - 2)); x <= Math.min(W - 1, Math.ceil(OC[0] + dx + OR + 2)); x++) {
    const sx = x - dx, sy = y - dy, a = Math.max(0, Math.min(1, OR + 0.5 - Math.hypot(sx - OC[0], sy - OC[1]))); if (a <= 0) continue;
    const xi = sx | 0, yi = sy | 0, fx = sx - xi, fy = sy - yi, o = yi * W + xi, i = y * W + x;
    const v = (ORB[o] * (1 - fx) + ORB[o + 1] * fx) * (1 - fy) + (ORB[o + W] * (1 - fx) + ORB[o + W + 1] * fx) * fy;
    f[i] += a * (v - UI[i]) * wgt;
  }
}

const cases = [];
const add = (name, kind, expect, draw) => cases.push({ name, kind, expect, draw });
/* cross-fades (fade from frame 46: the middle of the clip) */
for (const n of [4, 8, 16, 30]) add('xfade-' + n, 'xfade', true, (t, f, i) => affine(mix(UI, TERM, fadeK(i, 46, n)), f, S0, 0, 0));
add('xfade-16-drift20', 'xfade', true, (t, f, i) => affine(mix(UI, TERM, fadeK(i, 46, 16)), f, S0, -16 + 20 * 0.8 * t, -12 + 20 * 0.6 * t));
add('xfade-30-drift40', 'xfade', true, (t, f, i) => affine(mix(CAST, THREAD, fadeK(i, 38, 30)), f, S0, -32 + 40 * 0.8 * t, -24 + 40 * 0.6 * t));
add('xfade-16-zoom2', 'xfade', true, (t, f, i) => affine(mix(THREAD, UI, fadeK(i, 46, 16)), f, S0 * 1.02 ** t, 0, 0));
/* a panel of the cast cards (15% of the frame) cross-fades into the same rect of the terminal frame, over the thread */
const PX = [525, 300, 951, 330];
const panelX = new Float32Array(W * H);
add('panel-xfade-16', 'xfade', true, (t, f, i) => { affine(THREAD, f, S0, 0, 0); affine(mix(CAST, TERM, fadeK(i, 46, 16)), panelX, S0, 0, 0); const [x0, y0, w, h] = PX; for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) f[y * W + x] = panelX[y * W + x]; });
/* moves that must not count */
for (const v of [2, 5, 10, 20, 40]) add('drift-' + v, v === 40 ? 'both' : 'xfade', false, (t, f) => affine(UI, f, S0, -0.8 * v + 0.8 * v * t, -0.6 * v + 0.6 * v * t));
add('drift-up-20', 'xfade', false, (t, f) => affine(TERM, f, S0, 0, 16 - 20 * t));
for (const z of [0.5, 1, 2, 3]) add('zoom-' + z, 'xfade', false, (t, f) => affine(CAST, f, S0 * (1 + z / 100) ** t, 0, 0));
const PP = [560, 160, 800, 520]; /* 20% of the frame */
for (const v of [10, 30]) add('panel-drift-' + v, 'xfade', false, (t, f) => { affine(THREAD, f, S0, 0, 0); panel(UI, f, PP, -0.8 * v + v * t, 0); });
add('cut', 'xfade', false, (t, f, i) => affine(i < 48 ? UI : TERM, f, S0, 0, 0));
const whip = (t) => [-300 + 600 * snap((t - 0.6) / 0.3), 0], quick = (t) => [-80 + 160 * snap((t - 0.5) / 0.5), 0];
add('whip-blur', 'both', false, (t, f) => blurred(f, t, whip, speedOf(whip), (g, [x, y], w, acc) => affine(UI, g, S0, x, y, w, acc)));
add('move-blur', 'both', false, (t, f) => blurred(f, t, quick, speedOf(quick), (g, [x, y], w, acc) => affine(TERM, g, S0, x, y, w, acc)));
/* double images: an orb flying across, two sharp copies against a smooth smear */
for (const [nm, mx, my] of [['h', 400, 0], ['diag', 340, -230]]) {
  const fly = (t) => { const p = travel((t - 0.35) / 0.5); return [-mx / 2 + mx * p, -my / 2 + my * p]; };
  for (const ends of [true, false]) add('orb-' + nm + '-' + (ends ? 'strobe' : 'smooth'), 'double', ends, (t, f) => {
    const ts = shutter(t, speedOf(fly)(t), ends);
    f.set(UI);
    for (const s of ts) orb(f, fly(s), 1 / ts.length);
  });
}
const rows = (t) => [0, -110 + 220 * travel((t - 0.35) / 0.5)];
add('list-v-smooth', 'double', false, (t, f) => blurred(f, t, rows, speedOf(rows), (g, [x, y], w, acc) => affine(UI, g, S0, x, y, w, acc)));

const results = [];
for (const c of cases) {
  if (only && !new RegExp(only).test(c.name)) continue;
  const file = join(dir, c.name + '.mp4');
  const t0 = Date.now();
  if (!(keep && existsSync(file))) await encode(file, c.draw);
  const p = probe(file);
  if (c.kind === 'xfade' || c.kind === 'both') {
    const ev = await crossfades(file, [], p.fps);
    const xf = ev.filter((e) => e.area >= XF_AREA);
    results.push({ name: c.name, check: 'cross-fade', expect: c.expect, got: xf.length > 0, detail: ev.map((e) => e.at + '-' + e.until + ' s ' + Math.round(e.area * 100) + '%').join(', ') || 'no blend' });
  }
  if (c.kind === 'double' || c.kind === 'both') {
    const ev = await doubleImages(file, p);
    results.push({ name: c.name, check: 'double image', expect: c.kind === 'both' ? false : c.expect, got: ev.length > 0, detail: ev.map((e) => e.at + '-' + e.until + ' s, ' + e.frames + ' frames, gap ' + e.gap + ' px').join('; ') || 'none' });
  }
  process.stderr.write(c.name + ' ' + (Date.now() - t0) + ' ms\n');
}
/* ── the page checks, on a synthetic page with window.__film (the same functions qa.mjs runs on the film) ── */
if (!only || /page|join|confirm/.test(only)) {
  const { serve } = await import('../lib/serve.mjs');
  const { openFilm } = await import('../lib/build.mjs');
  const { writeFileSync } = await import('node:fs');
  const { textEdges, actSpans, chipBaselines } = await import('./layout.mjs');
  const { confirmDoubles, videoJoins } = await import('./frames.mjs');
  const site = join(dir, 'page'); mkdirSync(site, { recursive: true });
  /* 2 s; the "acts" a1 [0, 1) and a3 [1, 2) */
  writeFileSync(join(site, 'index.html'), `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;background:#111;overflow:hidden} .film-stage{position:relative;width:1920px;height:1080px;overflow:hidden;background:#151515;color:#eee;font:40px/1.3 sans-serif}
    .abs{position:absolute;white-space:nowrap} .chip{display:inline-flex;align-items:center;height:40px;padding:0 12px;border-radius:20px;background:#333;font:500 32px/1 sans-serif;vertical-align:-8px}
  </style><div class="film-stage">
    <div class="abs" id="inside" style="left:400px;top:400px">This line sits well inside</div>
    <div class="abs" id="right" style="left:1700px;top:520px">This line is cut by the right edge</div>
    <div class="abs" id="top" style="left:600px;top:12px">A headline too near the top</div>
    <div class="abs" id="fast" style="left:0;top:700px">A line whipping out fast</div>
    <div class="abs" style="left:800px;top:820px;width:120px;height:60px;overflow:hidden"><div style="white-space:nowrap">masked inside a box</div></div>
    <p class="abs" id="ok" style="left:300px;top:240px;margin:0">ask <span class="ui-mention chip"><span class="ui-mention__name">kai</span></span> is it ready?</p>
    <p class="abs" id="low" style="left:1000px;top:240px;margin:0">ask <span class="ui-mention chip" style="position:relative;top:15px"><span class="ui-mention__name">nina</span></span> to ship</p>
    <div class="a1-card abs" style="left:300px;top:900px;padding:10px;background:#2a2a2a">act 1's card</div>
    <div class="a1-room abs" style="left:600px;top:960px;padding:10px;background:#2a2a2a">act 1's room, carried on</div>
    <div class="a3-clip abs" id="clip" style="left:1100px;top:900px;visibility:hidden"><div style="visibility:visible;background:#2a2a2a;padding:10px">act 3's composer</div></div>
    <div class="a3-late abs" id="late" style="left:1500px;top:900px;padding:10px;background:#2a2a2a;opacity:0">act 3's late card</div>
    <div class="abs" id="mover" style="left:0;top:560px;width:120px;height:160px;border-radius:30px;background:#5ec8a8"><i style="position:absolute;left:30px;top:50px;width:16px;height:56px;border-radius:8px;background:#111"></i><i style="position:absolute;left:70px;top:50px;width:16px;height:56px;border-radius:8px;background:#111"></i></div>
  </div><script>
    const $ = (id) => document.getElementById(id);
    function at(t) {
      $('fast').style.left = (-200 - 1200 * t) + 'px';                      /* 20 px a frame, bleeding off the left */
      document.querySelector('.a1-card').style.opacity = t < 0.75 || (t >= 1.5 && t < 1.75) ? 1 : 0;  /* act 1's card comes back in act 3 */
      $('late').style.opacity = t >= 1 ? 1 : 0;                              /* drawn only in act 3 */
      $('mover').style.transform = 'translateX(' + (300 + 3600 * t) + 'px)'; /* 60 px a frame */
    }
    window.__film = { name: 'selftest', duration: 2, fps: 60, width: 1920, height: 1080, offset: 0,
      seek: (t) => { at(t); return new Promise((r) => requestAnimationFrame(() => r())); } };
    at(0); document.documentElement.dataset.filmReady = '1';
  </script>`);
  const srv = await serve(site);
  const { browser, context, page } = await openFilm(srv.url + 'index.html?x=1');
  try {
    const edges = await textEdges(page, { step: 0.5 });
    const got = (re) => edges.some((e) => re.test(e.text));
    results.push({ name: 'page-text-edge', check: 'text at edge', expect: true, got: got(/cut by the right/) && got(/too near the top/), detail: edges.map((e) => '"' + e.text.slice(0, 26) + '" ' + e.kind).join('; ') });
    results.push({ name: 'page-text-inside', check: 'text at edge', expect: false, got: got(/well inside|whipping|masked/), detail: 'inside, masked, and a fast bleed are not flagged' });
    const spans = await actSpans(page, { a1: [0, 1], a2: [1, 1], a3: [1, Infinity], a4: [2, 2] }, { step: 0.25 });
    const own = (o) => spans.find((e) => e.owner.includes(o) && !e.carried);
    results.push({ name: 'page-act-span-linger', check: 'act span', expect: true, got: !!own('a1-card'), detail: own('a1-card') ? 'a1-card drawn ' + own('a1-card').from + '-' + own('a1-card').to + ' s' : 'not found' });
    results.push({ name: 'page-act-span-hidden-parent', check: 'act span', expect: true, got: !!own('a3-clip'), detail: own('a3-clip') ? 'a3-clip drawn ' + own('a3-clip').from + '-' + own('a3-clip').to + ' s (visible child of a hidden parent)' : 'not found' });
    results.push({ name: 'page-act-span-in-span', check: 'act span', expect: false, got: !!own('a3-late'), detail: 'a3-late drawn only inside act 3' });
    const carry = spans.find((e) => e.owner.includes('a1-room'));
    results.push({ name: 'page-act-span-carry', check: 'act span', expect: false, got: !!own('a1-room'), detail: carry ? 'a1-room ' + carry.when : 'not seen' });
    const chips = await chipBaselines(page, { step: 1 });
    const off = (n) => chips.off.find((c) => c.chip.includes(n)), all = (n) => chips.all.find((c) => c.chip.includes(n));
    results.push({ name: 'page-chip-low', check: 'chip baseline', expect: true, got: !!off('nina'), detail: all('nina') ? 'nina ' + all('nina').offset + ' px against ' + all('nina').expected : 'not measured' });
    results.push({ name: 'page-chip-ok', check: 'chip baseline', expect: false, got: !!off('kai'), detail: all('kai') ? 'kai ' + all('kai').offset + ' px against ' + all('kai').expected : 'not measured' });
    /* the confirmation: "renders" of the page with the shutter's two ends against 64 samples, then compared with a
       64-sample re-render of the same page */
    const { pageExposure } = await import('./frames.mjs');
    const cdp = await context.newCDPSession(page);
    for (const [nm, n, expect] of [['confirm-two-samples', 2, true], ['confirm-smooth', 64, false]]) {
      const file = join(dir, nm + '.mp4');
      const p = spawn(FFMPEG, ['-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', '480x270', '-r', '60', '-i', 'pipe:0', '-vf', 'scale=1920:1080', '-c:v', 'libx264', '-crf', '14', '-pix_fmt', 'yuv420p', '-y', file], { stdio: ['pipe', 'ignore', 'inherit'] });
      for (let k = 0; k < 12; k++) { const e = await pageExposure(page, cdp, (4 + k) / 60, { W: 1920, H: 1080, w: 480, n }); p.stdin.write(Buffer.from(Uint8Array.from(e.g, (v) => Math.max(0, Math.min(255, Math.round(v)))))); }
      p.stdin.end(); await new Promise((r) => p.on('close', r));
      /* the clip's frame k is the page's frame 4 + k: shift the page by 4 frames */
      await page.evaluate(() => { const s = window.__film.seek; window.__film.seek = (t) => s(t + 4 / 60); });
      const cf = await confirmDoubles(page, cdp, file, [4, 8], { W: 1920, H: 1080, fps: 60 });
      await page.evaluate(() => { const s = window.__film.seek; window.__film.seek = (t) => s(t - 4 / 60); });
      results.push({ name: nm, check: 'confirm 64', expect, got: cf.some((c) => c.status === 'doubled'), detail: cf.map((c) => 'f' + c.frame + ' ' + c.status + (c.regions[0] ? ' ' + c.regions[0].box.join(',') : '')).join('; ') });
    }
  } finally { await browser.close(); await srv.close(); }
  /* the joins: four "acts" whose seams match, shift a panel 10 px, and change the faces in a corner */
  const base = UI, shifted = new Float32Array(W * H);
  affine(UI, shifted, 1, 0, 0); panel(UI, shifted, [200, 300, 800, 500], 10, 0);
  const faces = Float32Array.from(shifted);
  for (let y = 100; y < 240; y++) for (let x = 100; x < 360; x++) faces[y * W + x] = 255 - faces[y * W + x];
  const acts = [[base, base], [base, base], [shifted, shifted], [faces, faces]];
  const files = [];
  for (let i = 0; i < 4; i++) { const f = join(dir, 'join-a' + (i + 1) + '.mp4'); const [first, last] = acts[i]; await encodeFrames(f, [first, first, last]); files.push(f); }
  const js = videoJoins(files, [1, 2, 3], { width: 1920, height: 1080 });
  results.push({ name: 'join-match', check: 'act join', expect: false, got: js[0].regions.some((r) => r.blocks >= 2), detail: js[0].regions.length + ' regions' });
  results.push({ name: 'join-shift', check: 'act join', expect: true, got: js[1].regions.some((r) => r.blocks >= 2), detail: js[1].regions.slice(0, 2).map((r) => r.box.join(',') + (r.moved ? ' moved ' + r.moved.join(',') : '')).join('; ') });
  results.push({ name: 'join-faces', check: 'act join', expect: true, got: js[2].regions.some((r) => r.blocks >= 2), detail: js[2].regions.slice(0, 2).map((r) => r.box.join(',')).join('; ') });
}

const wn = Math.max(...results.map((r) => r.name.length));
console.log('\nchecker self-test (' + dir + ')');
for (const r of results) console.log((r.got === r.expect ? ' ok  ' : 'FAIL ') + r.name.padEnd(wn) + '  ' + r.check.padEnd(12) + '  expect ' + (r.expect ? 'flag' : 'pass') + ', got ' + (r.got ? 'flag' : 'pass') + '   ' + r.detail);
const bad = results.filter((r) => r.got !== r.expect).length;
console.log(bad ? '\n' + bad + ' case(s) wrong' : '\nall ' + results.length + ' cases right');
if (!keep && !dirArg) rmSync(dir, { recursive: true, force: true });
process.exitCode = bad ? 1 : 0;
