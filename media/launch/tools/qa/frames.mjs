/* Frame comparisons: the act joins, and the double-image confirmation against a re-render at 64 samples.

     joins         the last frame of act N against the first of act N+1 (9.600, 20.000, 32.000 s): from the renders
                   (each act's file), and from the page (act N's scene at its last frame against act N+1's at 0, no
                   grain). Both frames at 480x270 (270x480 for 9:16), a 3x3 box over each to take the grain out, then
                   8x8 blocks whose mean difference is over 4 grey levels (2 from the page, which has no grain or
                   codec); touching blocks are one region, reported in the video's pixels with how far its content
                   moved (the shift up to 24 px that matches it best, when it explains the change).
     confirm       a few frames of a render re-rendered from the page with 64 sub-frames over the shutter (captured in
                   order, averaged in linear light, no grain) and compared with the render at 480x270 after a 3x3 box:
                   6 or more touching pixels over 12 levels apart are where the render's motion blur departs from a
                   smooth one, which is a double image (or a stale sample). The frames are the double-image detector's and the moments of the
                   render's fastest motion. When the render and the page disagree on most of the frame, the render is
                   not of this page's source and nothing is confirmed. */
import { execFileSync } from 'node:child_process';
import { decodePNG } from '../lib/png.mjs';
import { round } from './video.mjs';

const FFMPEG = process.env.FFMPEG || '/usr/bin/ffmpeg';

/* a grey frame of a video at w x h: the first, the last, or frame n */
export function videoFrame(file, { w, h, which = 'first', n = 0 }) {
  const vf = 'scale=' + w + ':' + h + ':flags=area,format=gray';
  const args = which === 'last' ? ['-v', 'error', '-sseof', '-0.25', '-i', file, '-vf', vf, '-f', 'rawvideo', '-']
    : which === 'first' ? ['-v', 'error', '-i', file, '-frames:v', '1', '-vf', vf, '-f', 'rawvideo', '-']
      : ['-v', 'error', '-i', file, '-vf', "select='eq(n\\," + n + ")'," + vf, '-frames:v', '1', '-f', 'rawvideo', '-'];
  const buf = execFileSync(FFMPEG, args, { maxBuffer: 256 << 20 });
  const N = w * h;
  if (buf.length < N) throw new Error('no frame from ' + file);
  return Float32Array.from(buf.subarray(buf.length - N - (buf.length % N), buf.length - (buf.length % N)));
}

const box3 = (f, w, h) => {
  const o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < h && xx >= 0 && xx < w) { s += f[yy * w + xx]; n++; } }
    o[y * w + x] = s / n;
  }
  return o;
};

/** regions where two grey frames (w x h) differ: [{ box: [x, y, w, h] in out px, diff, moved }] and the share of blocks */
export function diffRegions(A, B, w, h, { level = 4, scale = 1 } = {}) {
  const a = box3(A, w, h), b = box3(B, w, h), bw = Math.ceil(w / 8), bh = Math.ceil(h / 8);
  const blk = new Float32Array(bw * bh), flag = new Uint8Array(bw * bh);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    let s = 0, n = 0;
    for (let y = by * 8; y < Math.min(h, by * 8 + 8); y++) for (let x = bx * 8; x < Math.min(w, bx * 8 + 8); x++) { s += Math.abs(a[y * w + x] - b[y * w + x]); n++; }
    blk[by * bw + bx] = s / n; if (s / n > level) flag[by * bw + bx] = 1;
  }
  const seen = new Uint8Array(bw * bh), regions = [];
  for (let i = 0; i < flag.length; i++) {
    if (!flag[i] || seen[i]) continue;
    const st = [i]; seen[i] = 1; let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, sum = 0, cnt = 0;
    while (st.length) {
      const j = st.pop(), x = j % bw, y = (j / bw) | 0;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); sum += blk[j]; cnt++;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) { const xx = x + dx, yy = y + dy, k = yy * bw + xx; if (xx >= 0 && yy >= 0 && xx < bw && yy < bh && flag[k] && !seen[k]) { seen[k] = 1; st.push(k); } }
    }
    /* did the content move? the shift (up to 12 px here) of A's region that best matches B's, if it halves the change */
    const X0 = x0 * 8, Y0 = y0 * 8, X1 = Math.min(w, x1 * 8 + 8), Y1 = Math.min(h, y1 * 8 + 8);
    const sad = (dx, dy) => { let s = 0, n = 0; for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; s += Math.abs(b[y * w + x] - a[yy * w + xx]); n++; } return n ? s / n : 1e9; };
    const s0 = sad(0, 0); let best = s0, mv = null;
    for (let dy = -12; dy <= 12; dy++) for (let dx = -12; dx <= 12; dx++) { if (!dx && !dy) continue; const s = sad(dx, dy); if (s < best) { best = s; mv = [dx, dy]; } }
    regions.push({ box: [Math.round(X0 * scale), Math.round(Y0 * scale), Math.round((X1 - X0) * scale), Math.round((Y1 - Y0) * scale)], diff: round(sum / cnt, 1), blocks: cnt, moved: mv && best < 0.5 * s0 ? [Math.round(-mv[0] * scale), Math.round(-mv[1] * scale)] : null });
  }
  return { regions: regions.sort((p, q) => q.blocks - p.blocks), share: round(flag.reduce((s, v) => s + v, 0) / flag.length, 3), median: round([...blk].sort((p, q) => p - q)[blk.length >> 1], 2) };
}

/** pixels where two grey frames (w x h) differ by more than level after the 3x3 box, grouped (8-connected) into
    regions of at least minArea pixels: [{ box, diff, pixels }] in out px; with the frame's median difference */
export function pixelRegions(A, B, w, h, { level = 12, minArea = 6, scale = 1 } = {}) {
  const a = box3(A, w, h), b = box3(B, w, h), d = new Float32Array(w * h), seen = new Uint8Array(w * h), regions = [];
  for (let i = 0; i < d.length; i++) d[i] = Math.abs(a[i] - b[i]);
  for (let i = 0; i < d.length; i++) {
    if (d[i] <= level || seen[i]) continue;
    const st = [i]; seen[i] = 1; let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, sum = 0, n = 0;
    while (st.length) {
      const j = st.pop(), x = j % w, y = (j / w) | 0;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); sum += d[j]; n++;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy, k = yy * w + xx; if (xx >= 0 && yy >= 0 && xx < w && yy < h && !seen[k] && d[k] > level) { seen[k] = 1; st.push(k); } }
    }
    if (n >= minArea) regions.push({ box: [Math.round(x0 * scale), Math.round(y0 * scale), Math.round((x1 - x0 + 1) * scale), Math.round((y1 - y0 + 1) * scale)], diff: round(sum / n, 1), pixels: n, moved: null });
  }
  const sorted = Float32Array.from(d).sort();
  return { regions: regions.sort((p, q) => q.pixels - p.pixels), median: round(sorted[sorted.length >> 1], 2), share: round(regions.reduce((s, r) => s + r.pixels, 0) / d.length, 3) };
}

/** the act joins in the renders: files are the four acts' videos in order (one variant) */
export function videoJoins(files, seams, { width, height }) {
  const w = width >= height ? 480 : 270, h = width >= height ? 270 : 480, scale = width / w;
  return seams.map((t, i) => {
    const A = videoFrame(files[i], { w, h, which: 'last' }), B = videoFrame(files[i + 1], { w, h, which: 'first' });
    return { at: t, from: files[i].split('/').pop(), to: files[i + 1].split('/').pop(), ...diffRegions(A, B, w, h, { level: 4, scale }) };
  });
}

/* a grey frame of the page now, at w x h (Chrome's screenshot scaled, then luma) */
export async function pageFrame(page, cdp, { W, H, w }) {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true, clip: { x: 0, y: 0, width: W, height: H, scale: w / W } });
  const img = decodePNG(Buffer.from(r.data, 'base64'));
  const g = new Float32Array(img.width * img.height);
  for (let i = 0; i < g.length; i++) g[i] = 0.2126 * img.rgb[i * 3] + 0.7152 * img.rgb[i * 3 + 1] + 0.0722 * img.rgb[i * 3 + 2];
  return { g, w: img.width, h: img.height };
}

/* a frame at time t from the page with n sub-frames over the shutter: captured in ascending time, averaged in linear
   light, back to sRGB grey */
const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const srgb = (v) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
export async function pageExposure(page, cdp, t, { W, H, w, n = 64, shutter = 0.5, fps = 60 }) {
  let acc = null, dims = null;
  for (let i = 0; i < n; i++) {
    const ts = n === 1 ? t : t + ((i + 0.5) / n - 0.5) * (shutter / fps);
    await page.evaluate((s) => window.__film.seek(Math.max(0, s), { paint: true }), ts);
    const f = await pageFrame(page, cdp, { W, H, w });
    if (!acc) { acc = new Float64Array(f.g.length); dims = f; }
    for (let k = 0; k < f.g.length; k++) acc[k] += lin(f.g[k]);
  }
  const g = new Float32Array(acc.length);
  for (let k = 0; k < g.length; k++) g[k] = srgb(acc[k] / n);
  return { g, w: dims.w, h: dims.h };
}

/** confirm double images in a render against the page re-rendered at 64 samples, at the given frame numbers */
export async function confirmDoubles(page, cdp, file, frames, { W, H, fps, shutter = 0.5, n = 64 }) {
  const w = W >= H ? 480 : 270, h = W >= H ? 270 : 480, scale = W / w, out = [];
  for (const k of frames) {
    const shipped = videoFrame(file, { w, h, which: 'n', n: k });
    const ref = await pageExposure(page, cdp, k / fps, { W, H, w, n, shutter, fps });
    const d = pixelRegions(shipped, ref.g, w, h, { level: 12, minArea: 6, scale });
    /* most of the frame disagreeing (or a high median) means the render is not of this source */
    const status = d.median > 3 || d.share > 0.2 ? 'mismatch' : d.regions.length ? 'doubled' : 'clean';
    out.push({ frame: k, t: round(k / fps, 3), status, median: d.median, share: d.share, regions: status === 'doubled' ? d.regions.slice(0, 4) : [] });
  }
  return out;
}

/** the frames of a video where the most moves (mean change at 160x90 from the frame before), at least gap frames apart */
export function fastestFrames(file, count = 6, gap = 30) {
  const buf = execFileSync(FFMPEG, ['-v', 'error', '-i', file, '-vf', 'scale=160:90,format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 512 << 20 });
  const N = 160 * 90, n = Math.floor(buf.length / N), d = [];
  for (let k = 1; k < n - 1; k++) { let s = 0; for (let i = 0; i < N; i++) s += Math.abs(buf[k * N + i] - buf[(k - 1) * N + i]); d.push([s / N, k]); }
  d.sort((a, b) => b[0] - a[0]);
  const picked = [];
  for (const [v, k] of d) { if (v < 1) break; if (picked.every((p) => Math.abs(p - k) >= gap)) picked.push(k); if (picked.length >= count) break; }
  return picked.sort((a, b) => a - b);
}
