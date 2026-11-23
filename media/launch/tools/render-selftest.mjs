#!/usr/bin/env node
/* The motion-blur self-test: a frame is a smooth blur or a sharp still, never two or three discrete copies.

   node tools/render-selftest.mjs [--scene a1 [--variant vertical]] [--scale 2] [--no-build] [--keep <dir>]
                                  [--only plan,pixels,set,det]   (default: every part)

   1. Spacing, from the motion: the renderer plans every frame of the test scene (src/engine/blurtest.ts: a small orb
      at 30 px a frame, darting eyes, the cursor on an arc, a word at 240 px a frame) and of --scene if given, in plan
      mode (no captures), and fails if any frame's neighbouring sub-frames sit more than the limit apart.
   2. Pixels, from the frames: it renders the test scene's worst frames three ways: as the renderer plans them; as a
      reference with the same shutter and sub-frames 0.25 px apart (a near-continuous blur); and FORCED to two
      sub-frames (the old fault, as a control). In the region the moving thing sweeps, the planned frame must match the
      reference: each pixel within the range of the reference's pixels around it (3x3, so a sub-pixel shift of a smear's
      end is no fault), by at most 3 levels anywhere and 2 for 99.9% of the region. A double image, a strobe or a banded
      smear is tens of levels outside it. The forced frame must fail the same test, which proves it can see the fault.
      --keep writes the frames for a person to look at.
   3. Determinism: a frame is the same pixels whatever was drawn before it. Frames of the test scene's overlapping
      glances and instant set (and of --scene, at --frames) are captured after seeking from 20 frames before and from
      20 frames after; the two must be identical, byte for byte.
   Exit code 1 on any failure. */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFilm, distDir, openFilm } from './lib/build.mjs';
import { serve } from './lib/serve.mjs';
import { decodePNG } from './lib/png.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); if (i < 0) return d; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const flag = (k) => { const i = argv.indexOf(k); if (i < 0) return false; argv.splice(i, 1); return true; };
const sceneFrames = opt('--frames', null);
const scene = opt('--scene', null), variant = opt('--variant', 'landscape'), scale = Number(opt('--scale', '1')), keep = opt('--keep', null), noBuild = flag('--no-build');
const spacing = Number(opt('--spacing', '1'));
const only = new Set((opt('--only', 'plan,pixels,set,det')).split(','));
const MAX_DIFF = 3, P999_DIFF = 2;
const dist = distDir(opt('--dist', null));
const work = keep ? resolve(keep) : mkdtempSync(join(tmpdir(), 'film-selftest-'));
mkdirSync(work, { recursive: true });
let failures = 0;
const say = (ok, msg) => { console.log((ok ? ' ok   ' : 'FAIL  ') + msg); if (!ok) failures++; };

const render = (args) => spawnSync(process.execPath, [join(HERE, 'render.mjs'), '--no-build', '--dist', dist, ...(args.includes('--spacing') ? [] : ['--spacing', String(spacing)]), ...args], { encoding: 'utf8', maxBuffer: 64 << 20 });

/* ── 1. spacing, planned from the motion ── */
if (!noBuild) await buildFilm(dist);
for (const s of only.has('plan') ? ['blurtest', ...(scene ? [scene] : [])] : []) {
  const log = join(work, 'plan-' + s + '.json');
  const r = render(['--scene', s, '--plan', '--plan-log', log, '--scale', String(scale), '--workers', '2', ...(s === scene && variant === 'vertical' ? ['--variant', 'vertical'] : [])]);
  const stats = JSON.parse(/\{"out".*\}/.exec(r.stdout)?.[0] ?? '{}');
  const b = stats.blur ?? {};
  say(r.status === 0 && (b.framesOverLimit ?? [1]).length === 0, s + ': every frame\'s sub-frames at most ' + spacing + ' px apart at ' + (stats.size ?? '?') + ' (worst ' + b.worstSpacing + ' px at frame ' + b.worstFrame + ', ' + b.worstWhat + '; ' + b.framesBlurred + ' frames blurred, ' + (b.shutterClosedDown ?? []).length + ' with the shutter closed down)' + (r.status ? '\n' + r.stderr.trim() : ''));
}

/* ── 2. pixels: the worst frames of each case, planned and forced to two ── */
const CASES = [
  { name: 'orb-run', sel: '[data-case="orb-run"]', lines: [0.68, 0.74, 0.8, 0.86], frames: [12, 30, 48] },
  { name: 'eyes', sel: '[data-case="eyes"] .film-orb__eyes path', lines: [0.35, 0.5, 0.65], frames: [9, 19, 29] },
  { name: 'cursor', sel: '[data-case="cursor"] svg', lines: [0.4, 0.5, 0.6], frames: [15, 16, 18] },
  { name: 'whip', sel: '[data-case="whip"]', lines: [0.45, 0.55], frames: [24, 27] }
];

const luma = (img) => { const o = new Float32Array(img.width * img.height); for (let i = 0; i < o.length; i++) o[i] = 0.2126 * img.rgb[i * 3] + 0.7152 * img.rgb[i * 3 + 1] + 0.0722 * img.rgb[i * 3 + 2]; return o; };
/** how far a frame's pixels fall outside the reference's 3x3 neighbourhood range, inside a box: largest, 99.9th percentile */
function diff(a, ref, W, [x0, y0, x1, y1]) {
  const d = [], H = Math.floor(ref.length / W);
  for (let y = Math.max(1, y0); y < Math.min(H - 1, y1); y++) for (let x = Math.max(1, x0); x < Math.min(W - 1, x1); x++) {
    let lo = 1e9, hi = -1e9;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const v = ref[(y + j) * W + x + i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    const p = a[y * W + x];
    d.push(p < lo ? lo - p : p > hi ? p - hi : 0);
  }
  if (!d.length) return { max: 0, p999: 0 };
  d.sort((p, q) => p - q);
  return { max: Math.round(d[d.length - 1] * 10) / 10, p999: Math.round(d[Math.floor((d.length - 1) * 0.999)] * 10) / 10 };
}

const srv = await serve(dist);
const { browser, page } = await openFilm(srv.url + 'index.html?render=1&scene=blurtest&nograin');
const shot = (frame, out, extra) => render(['--scene', 'blurtest', '--still', String(frame), '--scale', String(scale), '--out', out, '--plan-log', out + '.plan.json', ...extra]);
const planOf = (out) => JSON.parse(readFileSync(out + '.plan.json', 'utf8')).plans[0] ?? { n: 1, angle: 180 };
const report = [];
for (const C of only.has('pixels') ? CASES : []) {
  for (const k of C.frames) {
    /* where the thing is across the shutter: its box at the shutter's two ends (each part, for the eyes) */
    const geo = await page.evaluate(async ([sel, k]) => {
      const f = window.__film, T = k / f.fps, D = 0.5 / f.fps, out = [];
      for (const t of [T - D / 2, T + D / 2]) {
        await f.seek(t, { paint: false });
        const root = document.querySelector('.film-stage').getBoundingClientRect();
        out.push([...document.querySelectorAll(sel)].map((e) => { const r = e.getBoundingClientRect(); return [r.left - root.left, r.top - root.top, r.width, r.height]; }));
      }
      return out;
    }, [C.sel, k]);
    /* the swept region: the union of the thing's boxes at the shutter's ends, 6 px around, in output px */
    const all = [...geo[0], ...geo[1]];
    const box = [Math.min(...all.map((r) => r[0])) - 6, Math.min(...all.map((r) => r[1])) - 6, Math.max(...all.map((r) => r[0] + r[2])) + 6, Math.max(...all.map((r) => r[1] + r[3])) + 6].map((v) => Math.round(v * scale));
    const base = join(work, C.name + '-f' + k);
    const rp = shot(k, base + '.png', []);
    if (rp.status !== 0) { say(false, C.name + ' frame ' + k + ': render failed\n' + rp.stderr); continue; }
    const plan = planOf(base + '.png');
    /* the reference: the same shutter, sub-frames 0.25 px apart and never closed down */
    const rr = shot(k, base + '-reference.png', ['--spacing', '0.25', '--max-samples', '2048', '--shutter', String(plan.n > 1 ? plan.angle : 180)]);
    const rf = shot(k, base + '-forced2.png', ['--fixed-samples', '2']);
    say(rf.status === 1 && /sub-frames more than/.test(rf.stderr), C.name + ' frame ' + k + ': the renderer refuses the forced two-sample frame (' + (rf.stderr.match(/worst [\d.]+ px/)?.[0] ?? 'no flag') + ')');
    if (rr.status !== 0) { say(false, C.name + ' frame ' + k + ': reference render failed\n' + rr.stderr); continue; }
    const ref = luma(decodePNG(readFileSync(base + '-reference.png')));
    const W = Math.round(1920 * scale);
    const results = {
      planned: { ...diff(luma(decodePNG(readFileSync(base + '.png'))), ref, W, box), n: plan.n, angle: plan.angle },
      forced: diff(luma(decodePNG(readFileSync(base + '-forced2.png'))), ref, W, box)
    };
    const p = results.planned, f = results.forced;
    if (!p || !f) continue;
    report.push({ case: C.name, frame: k, box, planned: p, forced2: f });
    const smooth = (r) => r.max <= MAX_DIFF && r.p999 <= P999_DIFF;
    say(smooth(p), C.name + ' frame ' + k + ': planned (' + p.n + ' sub-frames at ' + p.angle + ' deg) matches the continuous reference (at most ' + p.max + ' levels off, 99.9% within ' + p.p999 + ')');
    say(!smooth(f), C.name + ' frame ' + k + ': the same test catches the forced two-sample frame (' + f.max + ' levels off, 99.9% within ' + f.p999 + ')');
  }
}
await browser.close();

/* ── the instant set: frame 60 holds the box at one place, never half at each ── */
if (only.has('set')) {
  const out = join(work, 'set-f60.png'), r = render(['--scene', 'blurtest', '--still', '60', '--out', out, '--scale', String(scale)]);
  if (r.status !== 0) say(false, 'set: render failed\n' + r.stderr);
  else {
    const img = decodePNG(readFileSync(out)), L = luma(img), W = img.width;
    const mean = (cx, cy) => { let s = 0, n = 0; for (let y = Math.round((cy - 40) * scale); y < (cy + 40) * scale; y++) for (let x = Math.round((cx - 40) * scale); x < (cx + 40) * scale; x++) { s += L[y * W + x]; n++; } return s / n; };
    const before = mean(1200, 850), after = mean(1500, 850), ground = mean(1350, 700);
    /* the box differs from the ground by 40 levels or more (darker on the light ground, lighter on the dark one) */
    const lit = (v) => Math.abs(v - ground) > 40, dark = (v) => Math.abs(v - ground) < 4;
    say((lit(after) && dark(before)) || (lit(before) && dark(after)), 'set: an instant change on a frame time cuts cleanly (box at its old place ' + before.toFixed(0) + ', new place ' + after.toFixed(0) + ', ground ' + ground.toFixed(0) + ')');
  }
}

/* ── 3. determinism: the same frame from before and from after ── */
if (only.has('det')) {
  const { createHash } = await import('node:crypto');
  const targets = [['blurtest', [34, 38, 42, 46, 60, 61]], ...(scene ? [[scene, (sceneFrames ?? '92,111,130,153,334').split(',').map(Number)]] : [])];
  for (const [s, frames] of targets) {
    const v = s === scene && variant === 'vertical';
    const o = await openFilm(srv.url + 'index.html?render=1&scene=' + s + '&nograin' + (v ? '&variant=vertical' : ''), v ? { width: 1080, height: 1920 } : {});
    const cdp = await o.context.newCDPSession(o.page);
    const grab = async (t) => { await o.page.evaluate((t) => window.__film.seek(t, { paint: false }), t); const r = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true, fromSurface: true }); return createHash('md5').update(decodePNG(Buffer.from(r.data, 'base64')).rgb).digest('hex'); };
    const fps = await o.page.evaluate(() => window.__film.fps);
    const bad = [];
    for (const k of frames) {
      await grab(Math.max(0, (k - 20) / fps)); const a = await grab(k / fps);
      await grab((k + 20) / fps); const b = await grab(k / fps);
      if (a !== b) bad.push(k);
    }
    say(bad.length === 0, s + ': frames ' + frames.join(', ') + ' identical seeked from before and from after' + (bad.length ? ' (differ: ' + bad.join(', ') + ')' : ''));
    await o.browser.close();
  }
}
await srv.close();
writeFileSync(join(work, 'selftest.json'), JSON.stringify(report, null, 1));
console.log(failures ? '\n' + failures + ' check(s) failed' + (keep ? '' : ' (rerun with --keep <dir> to look at the frames)') : '\nmotion blur: every check passes');
if (!keep) rmSync(work, { recursive: true, force: true });
process.exitCode = failures ? 1 : 0;
