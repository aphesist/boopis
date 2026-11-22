/* What the checker measures on a rendered video. The methods are the research's (research/measure, corpus.md):
   the same thumbnails and thresholds, so a number here means what it means in the corpus table.

     stillness    12 fps steps on a 160x90 grey thumbnail; a step is still when the mean luma change is under 0.6;
                  still share, longest hold (the longest run of still steps), holds of 1 s or more, motion index
     blacks       every frame at 160x90: PURE black when 99% of pixels are at most 4 and none above 32 (nothing at all
                  on screen); NEAR black (an empty frame between scenes) when 99% are at most 16
     cuts         hard cuts: ffmpeg's scene score above 0.22 (the corpus's threshold), merged within 3 frames
     crossfades   a frame that is a blend of the frames before and after it: over the pixels that differ between
                  f(t-w) and f(t+w), f(t) = a f(t-w) + (1-a) f(t+w) with a in [0.15, 0.85] and a small residual
                  (morphs, moves and motion blur leave a large one), for w of 3 to 12 frames at 30 fps; runs of 3 or
                  more such frames are reported with the share of the frame they cover (qa.mjs fails those over 8%:
                  a layer cross-fading; smaller ones are element fades), fades to and from black are left to `blacks`
     words        the first frame with a line of text (a band of rows dense with letter edges); a heuristic for videos
                  without a page (the page's DOM is exact: page.mjs) */
import { spawn, execFileSync } from 'node:child_process';

const FFMPEG = process.env.FFMPEG || '/usr/bin/ffmpeg';

export function probe(file) {
  const j = JSON.parse(execFileSync('/usr/bin/ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file]).toString());
  const v = j.streams.find((s) => s.codec_type === 'video');
  const [a, b] = v.r_frame_rate.split('/').map(Number);
  return { width: v.width, height: v.height, fps: a / b, duration: Number(j.format.duration), frames: Number(v.nb_frames) || Math.round((Number(j.format.duration) * a) / b), audio: j.streams.some((s) => s.codec_type === 'audio') };
}

/** grey frames as one buffer (n x h x w) */
export function grey(file, { fps, w, h, from = 0, dur = null }) {
  return new Promise((ok, fail) => {
    const args = ['-v', 'error', ...(from ? ['-ss', String(from)] : []), '-i', file, ...(dur ? ['-t', String(dur)] : []), '-vf', (fps ? 'fps=' + fps + ',' : '') + 'scale=' + w + ':' + h + ',format=gray', '-f', 'rawvideo', '-'];
    const p = spawn(FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = []; let err = '';
    p.stdout.on('data', (c) => chunks.push(c));
    p.stderr.on('data', (c) => { err += c; });
    p.on('close', (code) => {
      if (code !== 0) return fail(new Error('ffmpeg: ' + err));
      const buf = Buffer.concat(chunks);
      ok({ w, h, n: Math.floor(buf.length / (w * h)), data: buf });
    });
  });
}

const runs = (flags) => {
  const out = [];
  for (let i = 0; i < flags.length;) {
    if (!flags[i]) { i++; continue; }
    let j = i; while (j < flags.length && flags[j]) j++;
    out.push([i, j]); i = j;
  }
  return out;
};

export async function stillness(file) {
  const g = await grey(file, { fps: 12, w: 160, h: 90 });
  const N = g.w * g.h, d = [];
  for (let k = 1; k < g.n; k++) {
    let s = 0;
    for (let i = 0; i < N; i++) s += Math.abs(g.data[k * N + i] - g.data[(k - 1) * N + i]);
    d.push(s / N);
  }
  const still = d.map((x) => x < 0.6);
  const rs = runs(still).map(([a, b]) => ({ start: (a + 1) / 12, steps: b - a, seconds: (b - a) / 12 }));
  const longest = rs.reduce((m, r) => (r.steps > m.steps ? r : m), { steps: 0, seconds: 0, start: 0 });
  return {
    stillShare: round(still.filter(Boolean).length / Math.max(1, still.length), 3),
    longestHold: round(longest.seconds, 2), longestHoldAt: round(longest.start, 2),
    holds1s: rs.filter((r) => r.steps >= 12).length,
    holdsOver15: rs.filter((r) => r.seconds > 1.5).map((r) => ({ at: round(r.start, 2), seconds: round(r.seconds, 2) })),
    motionIndex: round(d.reduce((a, b) => a + b, 0) / Math.max(1, d.length), 3)
  };
}

export async function blacks(file, fps) {
  const g = await grey(file, { fps: null, w: 160, h: 90 });
  const N = g.w * g.h, pure = [], near = [];
  const hist = new Uint32Array(256);
  for (let k = 0; k < g.n; k++) {
    hist.fill(0); let max = 0;
    for (let i = 0; i < N; i++) { const v = g.data[k * N + i]; hist[v]++; if (v > max) max = v; }
    let c = 0, p99 = 0;
    for (let v = 0; v < 256; v++) { c += hist[v]; if (c >= 0.99 * N) { p99 = v; break; } }
    pure.push(p99 <= 4 && max <= 32);
    near.push(p99 <= 16);
  }
  const fmt = (rs) => rs.map(([a, b]) => ({ at: round(a / fps, 2), seconds: round((b - a) / fps, 3) }));
  const p = fmt(runs(pure)), n = fmt(runs(near));
  return { pure: p.length, pureSeconds: round(p.reduce((s, r) => s + r.seconds, 0), 2), pureAt: p, near: n.length, nearAt: n, flags: near };
}

export function cuts(file, fps) {
  return new Promise((ok, fail) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-i', file, '-an', '-vf', "scale=320:-2,select='gt(scene,0.22)',showinfo", '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (c) => { err += c; });
    p.on('close', (code) => {
      if (code !== 0) return fail(new Error('ffmpeg scene: ' + err.slice(-500)));
      const t = [...err.matchAll(/pts_time:([0-9.]+)/g)].map((m) => Number(m[1])).filter((x) => x > 0.05);
      const merged = [];
      for (const c of t) if (!merged.length || c - merged[merged.length - 1] > 3 / fps) merged.push(round(c, 3));
      ok(merged);
    });
  });
}

export async function crossfades(file, blackFlags, srcFps) {
  const FPS = 30, W = 240, H = 136;
  const g = await grey(file, { fps: FPS, w: W, h: H });
  const N = W * H, f = g.data;
  const nearBlack = (k) => { const s = Math.round((k / FPS) * srcFps); return !!blackFlags[Math.min(blackFlags.length - 1, Math.max(0, s))]; };
  const hit = new Array(g.n).fill(null);
  for (let k = 3; k < g.n - 3; k++) {
    let best = null;
    for (const w of [3, 5, 8, 12]) {
      if (k - w < 0 || k + w >= g.n) continue;
      if (nearBlack(k - w) || nearBlack(k + w)) continue;
      const A = (k - w) * N, B = (k + w) * N, F = k * N;
      let sdd = 0, sfd = 0, cnt = 0;
      for (let i = 0; i < N; i++) {
        const d = f[A + i] - f[B + i];
        if (d > 12 || d < -12) { sdd += d * d; sfd += (f[F + i] - f[B + i]) * d; cnt++; }
      }
      const area = cnt / N;
      if (area < 0.02 || sdd === 0) continue;
      const a = sfd / sdd;
      if (a < 0.15 || a > 0.85) continue;
      let se = 0;
      for (let i = 0; i < N; i++) {
        const d = f[A + i] - f[B + i];
        if (d > 12 || d < -12) { const e = f[F + i] - f[B + i] - a * d; se += e * e; }
      }
      const r = Math.sqrt(se / sdd);
      if (r < 0.3 && (!best || r < best.r)) best = { a, r, area, w };
    }
    hit[k] = best;
  }
  const events = runs(hit.map(Boolean)).filter(([a, b]) => b - a >= 3).map(([a, b]) => {
    const seg = hit.slice(a, b);
    return { at: round(a / FPS, 2), until: round(b / FPS, 2), seconds: round((b - a) / FPS, 2), area: round(Math.max(...seg.map((s) => s.area)), 3), residual: round(Math.min(...seg.map((s) => s.r)), 3) };
  });
  return events;
}

/** the first time a line of text is on screen: a band of at least `rows` rows dense with strong vertical edges */
export async function firstWords(file, upTo = 20) {
  const W = 480, H = 270, FPS = 6;
  const g = await grey(file, { fps: FPS, w: W, h: H, dur: upTo });
  const N = W * H;
  for (let k = 0; k < g.n; k++) {
    const o = k * N;
    let band = 0;
    for (let y = 0; y < H; y++) {
      /* edges along the row, and whether they cluster like letters (at least 12 within any 120 px) */
      const xs = [];
      for (let x = 1; x < W; x++) { const d = g.data[o + y * W + x] - g.data[o + y * W + x - 1]; if (d > 50 || d < -50) xs.push(x); }
      let dense = false;
      for (let i = 0, j = 0; i < xs.length; i++) { while (xs[i] - xs[j] > 120) j++; if (i - j + 1 >= 12) { dense = true; break; } }
      band = dense ? band + 1 : 0;
      if (band >= 4) return round(k / FPS, 2);
    }
  }
  return null;
}

export const round = (x, n) => Math.round(x * 10 ** n) / 10 ** n;
