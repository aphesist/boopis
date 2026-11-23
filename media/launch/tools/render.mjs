#!/usr/bin/env node
/* The film's renderer: Playwright workers over frame ranges, raw frames piped into ffmpeg, sub-frame motion blur.

   node tools/render.mjs --scene test [options]

   What                --scene <name>            a scene in src/scenes (default test)
                       --variant vertical        the 1080x1920 composition (the scene lays itself out for it)
   Range               --from <s> --to <s>       seconds (or --from-frame / --to-frame); default the whole film
   Size                --scale 2                 4K (3840x2160): the same page at deviceScaleFactor 2
                       --preview                 fast check: 960x540, 30 fps, no motion blur, CRF 23 veryfast
   Motion blur         --shutter 180             the shutter angle; --samples 1 turns motion blur off
                       --spacing 1               the most output px between neighbouring sub-frames: each frame gets
                                                 as many sub-frames as its fastest on-screen motion needs (one when
                                                 nothing moves more than that across the shutter)
                       --max-samples 96          above it the shutter closes down instead (a shorter, still continuous
                                                 streak); never a strobe
                       --plan                    plan only: measure every frame's motion and sub-frames, capture
                                                 nothing; fails if any frame's spacing exceeds the limit
                       --plan-log <file.json>    every frame's plan (sub-frames, shutter, worst spacing, what moved)
   Output              --codec h264|prores|lossless   (default h264: CRF 14, yuv420p, BT.709)
                       --crf 14  --fps 60
                       --out <file>              default SC/renders/<scene>-<variant>-<size>.<ext>
                       --audio <file.wav>        mux a wav under the picture (AAC 320k in mp4, PCM in mov/mkv)
   Still               --still <frame> | --at <s>    one frame to PNG (boards, reviews); add --samples 1 for no blur
   Mux only            --mux <video> --audio <wav> --out <file>
   Page                --query "beat=b03"        extra page parameters (the board scene's beat)
   Checks              --hashes <file.json>      the md5 of every frame's pixels (determinism)
   Speed               --workers 4               parallel browsers (one per core is right on this machine)
                       --chunk 48                frames per job; workers take the next job as they finish, so a
                                                 heavy stretch (a dive asking for 96 sub-frames) is shared out
                                                 (default: a quarter of each worker's share, 30 frames or more)
                       --no-build                serve the existing build
                       --dist <dir>              build into and serve this folder instead of dist/ (also FILM_DIST) */
import { fork } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './lib/serve.mjs';
import { buildFilm, distDir, openFilm, SC } from './lib/build.mjs';
import { concat, EXT, mux, probe } from './lib/encode.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const flag = (k) => { const i = argv.indexOf(k); if (i < 0) return false; argv.splice(i, 1); return true; };
const opt = (k, d) => { const i = argv.indexOf(k); if (i < 0) return d; const v = argv[i + 1]; argv.splice(i, 2); return v; };

const o = {
  scene: opt('--scene', 'test'),
  variant: opt('--variant', 'landscape'),
  preview: flag('--preview'),
  noBuild: flag('--no-build'),
  dist: opt('--dist', null),
  scale: Number(opt('--scale', '1')),
  fps: opt('--fps', null),
  samples: opt('--samples', null),
  spacing: Number(opt('--spacing', '1')),
  maxSamples: Number(opt('--max-samples', '96')),
  fixedSamples: Number(opt('--fixed-samples', '0')),
  plan: flag('--plan'),
  planLog: opt('--plan-log', null),
  shutter: Number(opt('--shutter', '180')),
  codec: opt('--codec', 'h264'),
  crf: opt('--crf', null),
  from: opt('--from', null), to: opt('--to', null),
  fromFrame: opt('--from-frame', null), toFrame: opt('--to-frame', null),
  still: opt('--still', null), at: opt('--at', null),
  out: opt('--out', null),
  audio: opt('--audio', null),
  mux: opt('--mux', null),
  hashes: opt('--hashes', null),
  workers: Number(opt('--workers', '4')),
  chunk: Number(opt('--chunk', '0')),
  query: opt('--query', ''),
  quiet: flag('--quiet')
};
if (argv.length) { console.error('unknown arguments: ' + argv.join(' ')); process.exit(2); }

const log = (...a) => { if (!o.quiet) console.log(...a); };

async function main() {
  if (o.mux) {
    if (!o.audio || !o.out) throw new Error('--mux needs --audio and --out');
    await mux(resolve(o.mux), resolve(o.audio), resolve(o.out));
    log('muxed', o.out);
    return;
  }
  if (o.preview) { o.scale = o.scale === 1 ? 0.5 : o.scale; o.fps ??= '30'; o.samples ??= '1'; }
  const fps = Number(o.fps ?? 60), samples = Math.max(1, Number(o.samples ?? 8));
  const still = o.still != null || o.at != null;
  const codec = still ? 'png' : o.codec;
  if (o.plan && still) throw new Error('--plan and --still do not go together');

  const dist = distDir(o.dist);
  if (!o.noBuild) { const t = Date.now(); await buildFilm(dist); log('built in ' + ((Date.now() - t) / 1000).toFixed(1) + ' s'); }
  if (!existsSync(join(dist, 'index.html'))) throw new Error('no build in ' + dist + ': run without --no-build');
  const srv = await serve(dist);
  try {
    const url = srv.url + 'index.html?render=1&scene=' + encodeURIComponent(o.scene) + (o.variant === 'vertical' ? '&variant=vertical' : '') + (o.query ? '&' + o.query.replace(/^[?&]/, '') : '');
    const meta = await readMeta(url);
    const total = Math.round(meta.duration * fps);
    let f0 = 0, f1 = total;
    if (o.fromFrame != null) f0 = Number(o.fromFrame); else if (o.from != null) f0 = Math.round(Number(o.from) * fps);
    if (o.toFrame != null) f1 = Number(o.toFrame); else if (o.to != null) f1 = Math.round(Number(o.to) * fps);
    if (still) { f0 = o.still != null ? Number(o.still) : Math.round(Number(o.at) * fps); f1 = f0 + 1; }
    f0 = Math.max(0, Math.min(total, f0)); f1 = Math.max(f0 + 1, Math.min(total + (still ? 1 : 0), f1));
    const W = Math.round(meta.width * o.scale), H = Math.round(meta.height * o.scale);
    const size = W + 'x' + H;
    const out = resolve(o.out ?? join(SC, 'renders', o.scene + (o.query ? '-' + o.query.replace(/[^a-z0-9]+/gi, '-') : '') + '-' + meta.variant + '-' + (still ? 'f' + f0 + '-' : '') + size + (o.preview ? '-preview' : '') + EXT[codec]));
    await mkdir(dirname(out), { recursive: true });
    const nWorkers = still ? 1 : Math.max(1, Math.min(o.workers, Math.ceil((f1 - f0) / 30)));
    log('render ' + o.scene + ' (' + meta.variant + ') frames ' + f0 + '..' + (f1 - 1) + ' of ' + total + ' at ' + fps + ' fps, ' + size + ', ' +
      (samples > 1 ? 'motion blur at ' + o.shutter + ' deg, sub-frames at most ' + o.spacing + ' px apart (up to ' + o.maxSamples + ')' + (o.fixedSamples ? ', FORCED to ' + o.fixedSamples : '') : 'no motion blur') + ', ' + (o.plan ? 'plan only' : codec) + ', ' + nWorkers + ' workers');
    const tmp = join(dirname(out), '.film-render-' + process.pid);
    await mkdir(tmp, { recursive: true });
    /* jobs smaller than a worker's share, taken from a queue: frames cost very different amounts (one capture for a
       still frame, 96 for a fast one), and a worker given a fixed contiguous share could be left alone with the dive */
    const chunks = [];
    const per = still ? f1 - f0 : o.chunk > 0 ? o.chunk : Math.max(30, Math.ceil((f1 - f0) / (nWorkers * 4)));
    for (let a = f0, i = 0; a < f1; a += per, i++) chunks.push({ a, b: Math.min(f1, a + per), seg: still ? out : join(tmp, 'seg' + String(i).padStart(4, '0') + EXT[codec]) });
    const t0 = Date.now();
    const progress = new Map();
    let lastLine = 0;
    const tick = () => {
      const done = [...progress.values()].reduce((s, p) => s + p.done, 0), renders = [...progress.values()].reduce((s, p) => s + p.renders, 0);
      const el = (Date.now() - t0) / 1000;
      const line = '  ' + done + '/' + (f1 - f0) + ' frames, ' + renders + ' captures, ' + (done / Math.max(el, 0.001)).toFixed(2) + ' fps';
      if (o.quiet) return;
      if (process.stdout.isTTY) process.stdout.write('\r' + line + '   ');
      else if (Date.now() - lastLine > 5000 || done === f1 - f0) { lastLine = Date.now(); console.log(line); }
    };
    const kids = [];
    const run = (c, i) => new Promise((ok, fail) => {
      const job = { url, f0: c.a, f1: c.b, width: meta.width, height: meta.height, scale: o.scale, fps, samples, shutter: o.shutter, codec, out: c.seg,
        preview: o.preview, crf: o.crf, hashes: !!o.hashes, still, threads: 4,
        spacing: o.spacing, maxSamples: o.maxSamples, fixedSamples: o.fixedSamples || 0, planOnly: o.plan };
      const w = fork(join(HERE, 'lib/worker.mjs'), [JSON.stringify(job)], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
      kids.push(w);
      let result = null;
      w.on('message', (m) => {
        if (m.type === 'progress') { progress.set(i, m); tick(); }
        else if (m.type === 'done') { progress.set(i, { done: m.frames, renders: m.renders }); tick(); result = { ...m, ...c }; }
        else if (m.type === 'error') fail(new Error('worker ' + i + ': ' + m.message));
      });
      w.on('exit', (code) => (result ? ok(result) : fail(new Error('worker ' + i + ' exited ' + code))));
    });
    const results = new Array(chunks.length);
    let nextJob = 0;
    const lane = async () => { while (nextJob < chunks.length) { const i = nextJob++; results[i] = await run(chunks[i], i); } };
    await Promise.all(Array.from({ length: Math.min(nWorkers, chunks.length) }, lane)).catch((e) => { for (const k of kids) k.kill('SIGTERM'); throw e; });
    const ms = Date.now() - t0;
    if (!o.quiet && process.stdout.isTTY) process.stdout.write('\n');
    if (!still && !o.plan) await concat(results.map((r) => r.seg), out, o.audio ? { audio: resolve(o.audio), duration: (f1 - f0) / fps } : {});
    await rm(tmp, { recursive: true, force: true });
    const frames = f1 - f0, renders = results.reduce((s, r) => s + r.renders, 0);
    const stats = { out, scene: o.scene, variant: meta.variant, size, fps, frames, captures: renders, samples, shutter: o.shutter, workers: nWorkers, seconds: +(ms / 1000).toFixed(2),
      fps_render: +(frames / (ms / 1000)).toFixed(2), captures_per_s: +(renders / (ms / 1000)).toFixed(2), errors: results.flatMap((r) => r.errors ?? []) };
    /* the blur plan: every frame's sub-frames and the worst spacing between neighbours */
    const plans = results.flatMap((r) => r.plans ?? []).sort((a, b) => a.k - b.k);
    /* over the limit: neighbouring sub-frames more than two spacings apart, two stage px at 4K (a copy shows from about
       2 px; a step up to that which would not shrink is the page quantising, layout snapping or orb2's four-decimal
       geometry under a deep zoom, reported as snapped; lib/worker.mjs) */
    const snap = o.spacing * 2 * Math.max(1, o.scale);
    const blurred = plans.filter((p) => p.n > 1), over = plans.filter((p) => p.worst > snap);
    const worst = plans.reduce((m, p) => (p.worst > m.worst ? p : m), { worst: 0, k: -1, n: 0, what: '' });
    const hist = {};
    for (const p of plans) { const b = p.n === 1 ? '1' : p.n <= 4 ? '2-4' : p.n <= 8 ? '5-8' : p.n <= 16 ? '9-16' : p.n <= 32 ? '17-32' : '33+'; hist[b] = (hist[b] ?? 0) + 1; }
    stats.blur = { spacingLimit: o.spacing, maxSamples: o.maxSamples, framesBlurred: blurred.length, framesStill: plans.length - blurred.length, histogram: hist,
      worstSpacing: worst.worst, worstFrame: worst.k, worstWhat: worst.what, shutterClosedDown: plans.filter((p) => p.n > 1 && p.angle < o.shutter - 0.05).map((p) => p.k), framesOverLimit: over.map((p) => p.k), framesSnapped: plans.filter((p) => p.worst > o.spacing * 1.05 && p.worst <= snap).map((p) => p.k),
      /* discontinuities under a shutter (something that changes in an instant): the shutter was kept off them; a scene
         that did not mean one has a pop there */
      jumps: plans.filter((p) => p.jumps).flatMap((p) => p.jumps.map((j) => ({ frame: p.k, t: j.t, px: j.size, what: j.what }))) };
    if (o.planLog) await writeFile(resolve(o.planLog), JSON.stringify({ scene: o.scene, size, fps, spacing: o.spacing, plans }, null, 0));
    if (!still && !o.plan) {
      const p = await probe(out);
      const v = p.streams.find((s) => s.codec_type === 'video');
      stats.check = { frames: Number(v.nb_read_frames ?? v.nb_frames), expected: frames, codec: v.codec_name, pix_fmt: v.pix_fmt, color: [v.color_space, v.color_primaries, v.color_transfer, v.color_range].join('/'), rate: v.r_frame_rate, audio: p.streams.some((s) => s.codec_type === 'audio') };
      if (stats.check.frames !== frames) throw new Error('frame count ' + stats.check.frames + ' != ' + frames + ' in ' + out);
    }
    if (o.hashes) {
      const all = {};
      for (const r of results) r.hashes.forEach((h, i) => { all[r.a + i] = h; });
      await writeFile(resolve(o.hashes), JSON.stringify({ scene: o.scene, variant: meta.variant, size, fps, samples, shutter: o.shutter, frames: all }, null, 0));
    }
    log(JSON.stringify(stats));
    if (stats.errors.length) console.error('page errors:', stats.errors);
    if (over.length) { console.error('motion blur: ' + over.length + ' frame(s) have sub-frames more than ' + o.spacing + ' px apart (worst ' + worst.worst + ' px at frame ' + worst.k + ', ' + worst.what + '): ' + over.slice(0, 20).map((p) => p.k + ' (' + p.worst + ' px, ' + p.n + ' sub-frames)').join(', ')); process.exitCode = 1; }
  } finally {
    await srv.close();
  }
}

async function readMeta(url) {
  const { browser, page } = await openFilm(url);
  try {
    return await page.evaluate(() => { const f = window.__film; return { duration: f.duration, fps: f.fps, width: f.width, height: f.height, variant: f.variant, cuts: f.cuts }; });
  } finally { await browser.close(); }
}

main().catch((e) => { console.error(e.stack || e); process.exit(1); });

