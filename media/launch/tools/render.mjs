#!/usr/bin/env node
/* The film's renderer: Playwright workers over frame ranges, raw frames piped into ffmpeg, sub-frame motion blur.

   node tools/render.mjs --scene test [options]

   What                --scene <name>            a scene in src/scenes (default test)
                       --variant vertical        the 1080x1920 composition (the scene lays itself out for it)
   Range               --from <s> --to <s>       seconds (or --from-frame / --to-frame); default the whole film
   Size                --scale 2                 4K (3840x2160): the same page at deviceScaleFactor 2
                       --preview                 fast check: 960x540, 30 fps, no motion blur, CRF 23 veryfast
   Motion blur         --samples 8 --shutter 180 sub-frames per moving frame and the shutter angle (1 = off);
                                                 frames where nothing moves get one capture
   Output              --codec h264|prores|lossless   (default h264: CRF 14, yuv420p, BT.709)
                       --crf 14  --fps 60
                       --out <file>              default SC/renders/<scene>-<variant>-<size>.<ext>
                       --audio <file.wav>        mux a wav under the picture (AAC 320k in mp4, PCM in mov/mkv)
   Still               --still <frame> | --at <s>    one frame to PNG (boards, reviews); add --samples 1 for no blur
   Mux only            --mux <video> --audio <wav> --out <file>
   Checks              --hashes <file.json>      the md5 of every frame's pixels (determinism)
   Speed               --workers 4               parallel browsers (one per core is right on this machine)
                       --no-build                serve the existing dist/ */
import { fork } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './lib/serve.mjs';
import { buildFilm, openFilm, ROOT, SC } from './lib/build.mjs';
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
  scale: Number(opt('--scale', '1')),
  fps: opt('--fps', null),
  samples: opt('--samples', null),
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

  if (!o.noBuild) { const t = Date.now(); await buildFilm(); log('built in ' + ((Date.now() - t) / 1000).toFixed(1) + ' s'); }
  if (!existsSync(join(ROOT, 'dist/index.html'))) throw new Error('no dist/: run without --no-build');
  const srv = await serve(join(ROOT, 'dist'));
  try {
    const url = srv.url + 'index.html?render=1&scene=' + encodeURIComponent(o.scene) + (o.variant === 'vertical' ? '&variant=vertical' : '');
    const meta = await readMeta(url);
    const total = Math.round(meta.duration * fps);
    let f0 = 0, f1 = total;
    if (o.fromFrame != null) f0 = Number(o.fromFrame); else if (o.from != null) f0 = Math.round(Number(o.from) * fps);
    if (o.toFrame != null) f1 = Number(o.toFrame); else if (o.to != null) f1 = Math.round(Number(o.to) * fps);
    if (still) { f0 = o.still != null ? Number(o.still) : Math.round(Number(o.at) * fps); f1 = f0 + 1; }
    f0 = Math.max(0, Math.min(total, f0)); f1 = Math.max(f0 + 1, Math.min(total + (still ? 1 : 0), f1));
    const W = Math.round(meta.width * o.scale), H = Math.round(meta.height * o.scale);
    const size = W + 'x' + H;
    const out = resolve(o.out ?? join(SC, 'renders', o.scene + '-' + meta.variant + '-' + (still ? 'f' + f0 + '-' : '') + size + (o.preview ? '-preview' : '') + EXT[codec]));
    await mkdir(dirname(out), { recursive: true });
    const nWorkers = still ? 1 : Math.max(1, Math.min(o.workers, Math.ceil((f1 - f0) / 30)));
    log('render ' + o.scene + ' (' + meta.variant + ') frames ' + f0 + '..' + (f1 - 1) + ' of ' + total + ' at ' + fps + ' fps, ' + size + ', ' +
      (samples > 1 ? samples + ' samples at ' + o.shutter + ' deg' : 'no motion blur') + ', ' + codec + ', ' + nWorkers + ' workers');
    const tmp = join(dirname(out), '.film-render-' + process.pid);
    await mkdir(tmp, { recursive: true });
    const chunks = [];
    for (let i = 0; i < nWorkers; i++) {
      const a = f0 + Math.floor(((f1 - f0) * i) / nWorkers), b = f0 + Math.floor(((f1 - f0) * (i + 1)) / nWorkers);
      if (b > a) chunks.push({ a, b, seg: still ? out : join(tmp, 'seg' + String(i).padStart(3, '0') + EXT[codec]) });
    }
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
    const results = await Promise.all(chunks.map((c, i) => new Promise((ok, fail) => {
      const job = { url, f0: c.a, f1: c.b, width: meta.width, height: meta.height, scale: o.scale, fps, samples, shutter: o.shutter, codec, out: c.seg,
        preview: o.preview, crf: o.crf, hashes: !!o.hashes, still, threads: Math.max(1, Math.floor(4 / nWorkers)) };
      const w = fork(join(HERE, 'lib/worker.mjs'), [JSON.stringify(job)], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
      kids.push(w);
      let result = null;
      w.on('message', (m) => {
        if (m.type === 'progress') { progress.set(i, m); tick(); }
        else if (m.type === 'done') { progress.set(i, { done: m.frames, renders: m.renders }); tick(); result = { ...m, ...c }; }
        else if (m.type === 'error') fail(new Error('worker ' + i + ': ' + m.message));
      });
      w.on('exit', (code) => (result ? ok(result) : fail(new Error('worker ' + i + ' exited ' + code))));
    }))).catch((e) => { for (const k of kids) k.kill('SIGTERM'); throw e; });
    const ms = Date.now() - t0;
    if (!o.quiet && process.stdout.isTTY) process.stdout.write('\n');
    if (!still) await concat(results.map((r) => r.seg), out, o.audio ? { audio: resolve(o.audio), duration: (f1 - f0) / fps } : {});
    await rm(tmp, { recursive: true, force: true });
    const frames = f1 - f0, renders = results.reduce((s, r) => s + r.renders, 0);
    const stats = { out, scene: o.scene, variant: meta.variant, size, fps, frames, captures: renders, samples, shutter: o.shutter, workers: nWorkers, seconds: +(ms / 1000).toFixed(2),
      fps_render: +(frames / (ms / 1000)).toFixed(2), captures_per_s: +(renders / (ms / 1000)).toFixed(2), errors: results.flatMap((r) => r.errors ?? []) };
    if (!still) {
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

