/* Double images: a moving thing drawn as two sharp copies (two shutter samples) where a smooth smear belongs.

   A frame's shutter is open for a fraction s of the frame (180 deg: 0.5), so anything moving v px a frame is smeared
   over L = s v px along its motion. Look along the motion at the frame's band-passed detail (the frame minus a 9x9
   box mean at 960x540, so edges and small marks, not big areas) and correlate it with itself shifted by a lag t:

     smooth smear   the band-passed detail of a box-blurred edge leads and trails by L with opposite signs: the
                    correlation at t = L is NEGATIVE (about -0.5), whatever the content
     two copies     every edge is there twice, L apart, with the same sign: the correlation at t = L is POSITIVE (about
                    +0.5), and since each copy is sharp it falls to about 0 at t = L/2

   So a block is doubled when the correlation is at least 0.3 somewhere in 0.85 L to 1.15 L, nowhere below -0.1 there,
   at most 0.1 at L/2, and 0.3 above it. Repeated UI (lists, chips, grids, two eyes) puts its peaks at its own pitch,
   not at the streak length, and a smear's negative lobe vetoes it when the two coincide.

   The motion is measured, not assumed: 32x32 blocks at 960x540, matched from the frame before to the frame after
   (coarse to fine from 1/8 scale, and around zero at full scale), and kept only if half of it also carries the frame
   before onto this one and this one onto the next (a repeat of type or rows can fake a match two frames apart, never
   at half the step). Only pixels that change across the three frames are correlated, so still type in a block stays
   out. A frame is doubled when 2 or more blocks are; runs of 2 or more doubled frames (gaps of one allowed) are
   reported with their time and the region the blocks cover.

   Calibrated on a synthetic two-sample strobe and the same move smoothly blurred (selftest.mjs), and on a1 of the
   launch film. What it cannot see: copies that do not move (a second copy standing still beside a still orb looks
   like a designed offset shape to any frame-by-frame test), and copies inside a smear that is otherwise continuous
   (the block's smear dominates). */
import { spawn } from 'node:child_process';
import { round } from './video.mjs';

const FFMPEG = process.env.FFMPEG || '/usr/bin/ffmpeg';
/* the analysis size: 960 on the long side, the video's aspect (set per video) */
const B = 32;
let W = 960, H = 540, BW = W / B, BH = Math.floor(H / B);

function stream(file, onFrame) {
  return new Promise((ok, fail) => {
    const p = spawn(FFMPEG, ['-v', 'error', '-i', file, '-vf', 'scale=' + W + ':' + H + ',format=gray', '-f', 'rawvideo', '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const N = W * H; let buf = Buffer.alloc(0), n = 0, err = '';
    p.stdout.on('data', (c) => { buf = buf.length ? Buffer.concat([buf, c]) : c; while (buf.length >= N) { onFrame(new Uint8Array(buf.subarray(0, N)), n++); buf = buf.subarray(N); } });
    p.stderr.on('data', (c) => { err += c; });
    p.on('close', (code) => (code ? fail(new Error('ffmpeg: ' + err.slice(-500))) : ok(n)));
  });
}

const half = (src, w, h) => {
  const w2 = w >> 1, h2 = h >> 1, out = new Float32Array(w2 * h2);
  for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) { const o = 2 * y * w + 2 * x; out[y * w2 + x] = (src[o] + src[o + 1] + src[o + w] + src[o + w + 1]) / 4; }
  return out;
};
/* a frame with its pyramid (1/2, 1/4, 1/8) and its integral image, each made the first time it is asked for */
function prepare(f) {
  let py = null, II = null;
  return {
    f,
    get py() { if (!py) { const l1 = half(f, W, H), l2 = half(l1, W >> 1, H >> 1); py = [f, l1, l2, half(l2, W >> 2, H >> 2)]; } return py; },
    get II() {
      if (!II) { II = new Float64Array((W + 1) * (H + 1)); for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += f[y * W + x]; II[(y + 1) * (W + 1) + x + 1] = II[y * (W + 1) + x + 1] + row; } } }
      return II;
    }
  };
}
/* the displacement of block (x0, y0, bw, bh) of P in Q with the least absolute difference, within r of (cx, cy),
   comparing every step-th pixel */
function match(P, Q, w, h, x0, y0, bw, bh, cx, cy, r, step = 1) {
  let best = Infinity, bx = cx, by = cy;
  for (let dy = cy - r; dy <= cy + r; dy++) for (let dx = cx - r; dx <= cx + r; dx++) {
    let s = 0;
    for (let y = 0; y < bh && s < best; y += step) {
      const yy = y0 + y + dy; if (yy < 0 || yy >= h) { s += 255 * bw; continue; }
      const ro = (y0 + y) * w + x0, rq = yy * w + x0 + dx;
      for (let x = 0; x < bw; x += step) { const xx = x0 + x + dx; s += xx < 0 || xx >= w ? 255 : Math.abs(P[ro + x] - Q[rq + x]); }
    }
    if (s < best) { best = s; bx = dx; by = dy; }
  }
  return [bx, by, best];
}
const bil = (f, w, h, x, y) => {
  if (x < 0) x = 0; if (y < 0) y = 0; if (x > w - 1.001) x = w - 1.001; if (y > h - 1.001) y = h - 1.001;
  const xi = x | 0, yi = y | 0, fx = x - xi, fy = y - yi, o = yi * w + xi;
  return (f[o] * (1 - fx) + f[o + 1] * fx) * (1 - fy) + (f[o + w] * (1 - fx) + f[o + w + 1] * fx) * fy;
};

/** the doubled blocks of frame C, with A the frame before and Z the frame after */
export function doubledBlocks(A, C, Z, shutter = 0.5) {
  const prev = A.f, cur = C.f, next = Z.f;
  let II;
  const boxMean = (x, y) => { const xa = Math.max(0, x - 4), xb = Math.min(W, x + 5), ya = Math.max(0, y - 4), yb = Math.min(H, y + 5);
    return (II[yb * (W + 1) + xb] - II[ya * (W + 1) + xb] - II[yb * (W + 1) + xa] + II[ya * (W + 1) + xa]) / ((xb - xa) * (yb - ya)); };
  const out = [];
  /* the outer ring of blocks is left out: what enters the frame has no frame before to match */
  for (let by = 1; by < BH - 1; by++) for (let bx = 1; bx < BW - 1; bx++) {
    const x0 = bx * B, y0 = by * B;
    let changed = 0;
    for (let y = 0; y < B; y += 2) for (let x = 0; x < B; x += 2) { const i = (y0 + y) * W + x0 + x, d = next[i] - prev[i]; if (d > 16 || d < -16) changed++; }
    if (changed < 16) continue;
    let [dx, dy] = match(A.py[3], Z.py[3], W >> 3, H >> 3, x0 >> 3, y0 >> 3, B >> 3, B >> 3, 0, 0, 12);
    if (Math.abs(dx) >= 12 || Math.abs(dy) >= 12) continue;
    [dx, dy] = match(A.py[2], Z.py[2], W >> 2, H >> 2, x0 >> 2, y0 >> 2, B >> 2, B >> 2, dx * 2, dy * 2, 2);
    [dx, dy] = match(A.py[1], Z.py[1], W >> 1, H >> 1, x0 >> 1, y0 >> 1, B >> 1, B >> 1, dx * 2, dy * 2, 2);
    let sad; [dx, dy, sad] = match(prev, next, W, H, x0, y0, B, B, dx * 2, dy * 2, 2, 2);
    const [zx, zy, zs] = match(prev, next, W, H, x0, y0, B, B, 0, 0, 2, 2);
    if (zs <= sad) { dx = zx; dy = zy; }
    const vx = dx / 2, vy = dy / 2, sp = Math.hypot(vx, vy), L = shutter * sp;
    const hi = Math.min(Math.ceil(1.15 * L), 32);
    if (L < 4) continue;
    let s1 = 0, s0 = 0, s2 = 0, s02 = 0;
    for (let y = 0; y < B; y += 2) for (let x = 0; x < B; x += 2) {
      const X = x0 + x, Y = y0 + y, i = Y * W + X;
      s1 += Math.abs(prev[i] - bil(cur, W, H, X + vx, Y + vy)); s0 += Math.abs(prev[i] - cur[i]);
      s2 += Math.abs(cur[i] - bil(next, W, H, X + vx, Y + vy)); s02 += Math.abs(cur[i] - next[i]);
    }
    if (s1 > 0.8 * s0 || s2 > 0.8 * s02) continue;
    II ??= C.II;
    const ux = vx / sp, uy = vy / sp, m = hi + 2, gw = B + 2 * m, gh = B + 2 * m;
    /* band-passed detail over the block and a margin, and what changes across the three frames (dilated by 2) */
    const G = new Float32Array(gw * gh), Mk = new Uint8Array(gw * gh), Md = new Uint8Array(gw * gh);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      const X = Math.min(W - 1, Math.max(0, x0 - m + x)), Y = Math.min(H - 1, Math.max(0, y0 - m + y)), i = Y * W + X;
      G[y * gw + x] = cur[i] - boxMean(X, Y);
      const a = prev[i], b = cur[i], c = next[i];
      if (Math.abs(c - a) > 12 || Math.abs(b - a) > 12 || Math.abs(c - b) > 12) Mk[y * gw + x] = 1;
    }
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      let v = 0;
      for (let yy = Math.max(0, y - 2); yy <= Math.min(gh - 1, y + 2) && !v; yy++) for (let xx = Math.max(0, x - 2); xx <= Math.min(gw - 1, x + 2); xx++) if (Mk[yy * gw + xx]) { v = 1; break; }
      Md[y * gw + x] = v;
    }
    let moving = 0;
    for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) moving += Md[(y + m) * gw + x + m];
    if (moving < 64) continue;
    const corr = (t) => {
      let sxy = 0, e1 = 0, e2 = 0;
      for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) {
        const gx = x + m, gy = y + m, j = gy * gw + gx;
        if (!Md[j]) continue;
        const qx = gx + ux * t, qy = gy + uy * t;
        if (!Md[Math.round(qy) * gw + Math.round(qx)]) continue;
        const d1 = G[j], d2 = bil(G, gw, gh, qx, qy);
        sxy += d1 * d2; e1 += d1 * d1; e2 += d2 * d2;
      }
      return e1 && e2 ? sxy / Math.sqrt(e1 * e2) : 0;
    };
    const atHalf = corr(Math.max(1, Math.round(L / 2)));
    if (atHalf > 0.1) continue;
    let atL = -1, low = 1;
    for (let t = Math.max(1, Math.round(0.85 * L)); t <= Math.min(hi, Math.round(1.15 * L)); t++) { const c = corr(t); atL = Math.max(atL, c); low = Math.min(low, c); }
    if (atL >= 0.3 && low >= -0.1 && atL - atHalf >= 0.3) out.push({ bx, by, speed: round(sp, 1), gap: round(L, 1), corr: round(atL, 2) });
  }
  return out;
}

/** events of doubled frames in a video: [{ at, until, frames, blocks, region: [x, y, w, h] in the video's pixels }] */
export async function doubleImages(file, { fps, width, height, shutter = 0.5 } = {}) {
  const portrait = height > width;
  W = portrait ? 540 : 960; H = portrait ? 960 : 540; BW = Math.floor(W / B); BH = Math.floor(H / B);
  const ring = [], doubled = [];
  await stream(file, (f, n) => {
    ring.push(prepare(f)); if (ring.length > 3) ring.shift();
    if (ring.length === 3) { const bl = doubledBlocks(ring[0], ring[1], ring[2], shutter); if (bl.length >= 2) doubled[n - 1] = bl; }
  });
  const ks = Object.keys(doubled).map(Number).sort((a, b) => a - b), events = [];
  for (const k of ks) { const e = events[events.length - 1]; if (e && k - e.last <= 2) { e.ks.push(k); e.last = k; } else events.push({ ks: [k], last: k }); }
  const sx = (width ?? W) / W, sy = (height ?? H) / H;
  return events.filter((e) => e.ks.length >= 2).map((e) => {
    const bl = e.ks.flatMap((k) => doubled[k]);
    const x0 = Math.min(...bl.map((b) => b.bx)) * B, y0 = Math.min(...bl.map((b) => b.by)) * B, x1 = (Math.max(...bl.map((b) => b.bx)) + 1) * B, y1 = (Math.max(...bl.map((b) => b.by)) + 1) * B;
    /* gap: the widest distance between the copies, in the video's pixels */
    return { at: round(e.ks[0] / fps, 2), until: round((e.last + 1) / fps, 2), frames: e.ks.length, blocks: bl.length, region: [Math.round(x0 * sx), Math.round(y0 * sy), Math.round((x1 - x0) * sx), Math.round((y1 - y0) * sy)], gap: round(Math.max(...bl.map((b) => b.gap)) * sx, 1) };
  });
}
