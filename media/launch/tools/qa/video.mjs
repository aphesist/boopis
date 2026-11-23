/* What the checker measures on a rendered video. The methods are the research's (research/measure, corpus.md):
   the same thumbnails and thresholds, so a number here means what it means in the corpus table.

     stillness    12 fps steps on a 160x90 grey thumbnail; a step is still when the mean luma change is under 0.6;
                  still share, longest hold (the longest run of still steps), holds of 1 s or more, motion index
     blacks       every frame at 160x90: PURE black when 99% of pixels are at most 4 and none above 32 (nothing at all
                  on screen); NEAR black (an empty frame between scenes) when 99% are at most 16
     cuts         hard cuts: ffmpeg's scene score above 0.22 (the corpus's threshold), merged within 3 frames
     crossfades   a frame that is a blend of the frames before and after it: over the pixels that differ between
                  f(t-w) and f(t+w), f(t) = a f(t-w) + (1-a) f(t+w) with a in [0.15, 0.85] and a small residual
                  (morphs, fast moves and motion blur leave a large one), for w of 3 to 12 frames at 30 fps. A slow
                  move fits that too: a sub-pixel shift of a smooth image changes it almost linearly, so the middle
                  frame of a drift is close to the average of its ends. So before a frame counts, motion gets its
                  turn, block by block (8x8 at 240x136, on a lightly blurred copy): if a translation carries f(t-w)
                  onto f(t+w) (Lucas-Kanade from an integer search, then from the neighbours' motions, which follows
                  pushes, zooms and a single panel drifting), and f(t) is that motion's halfway point, the block is
                  moving; only blocks that motion cannot explain and the blend fits (residual under 0.3 there too)
                  are counted. A frame is a blend when those cover 2% of the frame or more; runs of 3 or more such
                  frames are reported (2 when they cover 8% or more: a 4-frame cross-fade at 60 fps is 2 frames at
                  30), with the share of the frame they cover once the gaps between lines and letters (up to 6 px,
                  48 px at 1080p) are closed, so a panel of type counts as the panel. qa.mjs fails those over 8%: a
                  layer cross-fading; smaller ones are element fades. A window that passes through a near-black frame
                  is a dip, left to `blacks`
     doubles      in doubles.mjs: moving things drawn as two sharp copies (shutter samples) instead of a smear
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

/* ── cross-fades: the blend test, then motion's turn ── */
const XW = 240, XH = 136, XN = XW * XH, XB = 8, XBW = XW / XB, XBH = Math.ceil(XH / XB), XNB = XBW * XBH;
/** a blend over this share of the frame is a layer cross-fading (the trailer's ghosted eyes measure 11%) */
export const XF_AREA = 0.08;
const clamp = (v, n) => (v < 0 ? 0 : v >= n ? n - 1 : v);
const isDiff = (d) => d > 12 || d < -12;

/* [1 2 1]/4 both ways: a smooth image interpolates well, and blur commutes with both a blend and a move */
const btmp = new Float32Array(XN);
function blur121(f, o, dst) {
  for (let y = 0; y < XH; y++) for (let x = 0; x < XW; x++) btmp[y * XW + x] = 0.25 * f[o + y * XW + clamp(x - 1, XW)] + 0.5 * f[o + y * XW + x] + 0.25 * f[o + y * XW + clamp(x + 1, XW)];
  for (let y = 0; y < XH; y++) for (let x = 0; x < XW; x++) dst[y * XW + x] = 0.25 * btmp[clamp(y - 1, XH) * XW + x] + 0.5 * btmp[y * XW + x] + 0.25 * btmp[clamp(y + 1, XH) * XW + x];
}

/* the block of img seen at (x + dx, y + dy), Catmull-Rom, edges clamped */
const wx = new Float64Array(4), wy = new Float64Array(4), hbuf = new Float64Array((XB + 3) * XB);
function catmull(t, w) { const t2 = t * t, t3 = t2 * t; w[0] = (-t3 + 2 * t2 - t) / 2; w[1] = (3 * t3 - 5 * t2 + 2) / 2; w[2] = (-3 * t3 + 4 * t2 + t) / 2; w[3] = (t3 - t2) / 2; }
function warp(img, x0, y0, bw, bh, dx, dy, out) {
  const ix = Math.floor(dx), iy = Math.floor(dy);
  catmull(dx - ix, wx); catmull(dy - iy, wy);
  for (let r = 0; r < bh + 3; r++) {
    const row = clamp(y0 + iy - 1 + r, XH) * XW;
    for (let c = 0; c < bw; c++) { const xb = x0 + c + ix - 1; hbuf[r * bw + c] = wx[0] * img[row + clamp(xb, XW)] + wx[1] * img[row + clamp(xb + 1, XW)] + wx[2] * img[row + clamp(xb + 2, XW)] + wx[3] * img[row + clamp(xb + 3, XW)]; }
  }
  for (let r = 0; r < bh; r++) for (let c = 0; c < bw; c++) out[r * bw + c] = wy[0] * hbuf[r * bw + c] + wy[1] * hbuf[(r + 1) * bw + c] + wy[2] * hbuf[(r + 2) * bw + c] + wy[3] * hbuf[(r + 3) * bw + c];
}

const fA = new Float32Array(XN), fB = new Float32Array(XN), fF = new Float32Array(XN);
const T = new Float64Array(XB * XB), GX = new Float64Array(XB * XB), GY = new Float64Array(XB * XB), P = new Float64Array(XB * XB);
const PA = new Float64Array(XB * XB), PF = new Float64Array(XB * XB), PG = new Float64Array(XB * XB);
const SEARCH = 2;
/* the block of fB as template: gradients and their sums (for Lucas-Kanade) */
function template(x0, y0, bw, bh) {
  let hxx = 0, hxy = 0, hyy = 0;
  for (let r = 0; r < bh; r++) for (let c = 0; c < bw; c++) {
    const x = x0 + c, y = y0 + r, j = r * bw + c;
    T[j] = fB[y * XW + x];
    GX[j] = (fB[y * XW + clamp(x + 1, XW)] - fB[y * XW + clamp(x - 1, XW)]) / 2;
    GY[j] = (fB[clamp(y + 1, XH) * XW + x] - fB[clamp(y - 1, XH) * XW + x]) / 2;
    hxx += GX[j] * GX[j]; hxy += GX[j] * GY[j]; hyy += GY[j] * GY[j];
  }
  return [hxx, hxy, hyy];
}
/* inverse-compositional Lucas-Kanade (regularised against the aperture problem) from (dx, dy): fA(x + d) ~ fB(x) */
function lucasKanade(x0, y0, bw, bh, dx, dy, [hxx, hxy, hyy]) {
  const n = bw * bh, lam = 1e-3 * (hxx + hyy) + 1, a = hxx + lam, d = hyy + lam, det = a * d - hxy * hxy, lim = SEARCH + 1;
  for (let it = 0; it < 8; it++) {
    warp(fA, x0, y0, bw, bh, dx, dy, P);
    let bx = 0, by = 0;
    for (let j = 0; j < n; j++) { const e = P[j] - T[j]; bx += GX[j] * e; by += GY[j] * e; }
    const ux = (d * bx - hxy * by) / det, uy = (a * by - hxy * bx) / det;
    dx = Math.max(-lim, Math.min(lim, dx - ux)); dy = Math.max(-lim, Math.min(lim, dy - uy));
    if (ux * ux + uy * uy < 1e-4) break;
  }
  return [dx, dy];
}

/** Which pixels of f(k) a blend of f(k-w) and f(k+w) explains and motion does not. For each 8x8 block that has pixels
    differing between the ends: the translation D with f(k-w)(x + D) ~ f(k+w)(x), and the motion's own prediction of
    f(k), a f(k-w)(x + (1-a)D) + (1-a) f(k+w)(x - aD), which tends to the blend as D tends to 0. The block is moving
    when D carries one end onto the other (rho, the share of the ends' difference left, under 0.5) and the halfway
    prediction does about as well as the blend (within 3x, plus a little noise); a blend block must also fit the blend
    on its own (residual under 0.3, as the frame does). Returns the share of pixels counted and their mask. */
const bD = new Array(XNB), bState = new Int8Array(XNB); /* 0: no differing pixels, 1: moving, 2: blend */
const mask = new Uint8Array(XN);
function blendNotMotion(f, k, w, a) {
  const A0 = (k - w) * XN, B0 = (k + w) * XN;
  blur121(f, A0, fA); blur121(f, B0, fB); blur121(f, k * XN, fF);
  const judge = (x0, y0, bw, bh, dx, dy) => {
    warp(fA, x0, y0, bw, bh, dx, dy, PA);
    warp(fA, x0, y0, bw, bh, (1 - a) * dx, (1 - a) * dy, PF);
    warp(fB, x0, y0, bw, bh, -a * dx, -a * dy, PG);
    let eb = 0, eab = 0, sdd = 0, ef = 0, nd = 0, fit = 0;
    for (let r = 0; r < bh; r++) for (let c = 0; c < bw; c++) {
      const i = (y0 + r) * XW + x0 + c, j = r * bw + c;
      const e2 = PA[j] - fB[i], e3 = fF[i] - a * PF[j] - (1 - a) * PG[j];
      fit += e2 * e2 + e3 * e3;
      if (!isDiff(f[A0 + i] - f[B0 + i])) continue;
      nd++;
      const d = fA[i] - fB[i], e = fF[i] - fB[i] - a * d;
      sdd += d * d; eb += e * e; eab += e2 * e2; ef += e3 * e3;
    }
    const moving = eab <= 0.5 * sdd && ef <= 3 * eb + 4 * nd;
    return { dx, dy, fit, nd, moving, blend: !moving && eb <= 0.09 * sdd };
  };
  bState.fill(0);
  for (let by = 0; by < XBH; by++) for (let bx = 0; bx < XBW; bx++) {
    const b = by * XBW + bx, x0 = bx * XB, y0 = by * XB, bw = XB, bh = Math.min(XB, XH - y0);
    let nd = 0;
    for (let r = 0; r < bh; r++) for (let c = 0; c < bw; c++) { const i = (y0 + r) * XW + x0 + c; if (isDiff(f[A0 + i] - f[B0 + i])) nd++; }
    if (!nd) continue;
    const H = template(x0, y0, bw, bh);
    let bs = Infinity, ix = 0, iy = 0;
    for (let dy = -SEARCH; dy <= SEARCH; dy++) for (let dx = -SEARCH; dx <= SEARCH; dx++) {
      let s = 0;
      for (let r = 0; r < bh && s < bs; r++) { const row = clamp(y0 + r + dy, XH) * XW; for (let c = 0; c < bw; c++) { const e = fA[row + clamp(x0 + c + dx, XW)] - T[r * bw + c]; s += e * e; } }
      if (s < bs) { bs = s; ix = dx; iy = dy; }
    }
    let m = null;
    for (const [sx, sy] of ix || iy ? [[ix, iy], [0, 0]] : [[0, 0]]) {
      const [dx, dy] = lucasKanade(x0, y0, bw, bh, sx, sy, H);
      const e = judge(x0, y0, bw, bh, dx, dy);
      if (!m || e.fit < m.fit) m = e;
    }
    bD[b] = m; bState[b] = m.moving ? 1 : 2;
  }
  /* a block motion did not explain tries its moving neighbours' motions (a drift is smooth; twice, so it spreads) */
  for (let pass = 0; pass < 2; pass++) {
    let changed = 0;
    for (let b = 0; b < XNB; b++) {
      if (bState[b] !== 2) continue;
      const bx = b % XBW, by = (b / XBW) | 0, x0 = bx * XB, y0 = by * XB, bh = Math.min(XB, XH - y0);
      let H = null; const tried = [];
      for (let ny = by - 1; ny <= by + 1 && bState[b] === 2; ny++) for (let nx = bx - 1; nx <= bx + 1; nx++) {
        if (nx < 0 || ny < 0 || nx >= XBW || ny >= XBH || (nx === bx && ny === by) || bState[ny * XBW + nx] !== 1) continue;
        const nb = bD[ny * XBW + nx];
        if (tried.some(([tx, ty]) => Math.abs(tx - nb.dx) + Math.abs(ty - nb.dy) < 0.15)) continue;
        tried.push([nb.dx, nb.dy]);
        H ??= template(x0, y0, XB, bh);
        const [dx, dy] = lucasKanade(x0, y0, XB, bh, nb.dx, nb.dy, H);
        const e = judge(x0, y0, XB, bh, dx, dy);
        if (e.moving) { bD[b] = e; bState[b] = 1; changed++; break; }
      }
    }
    if (!changed) break;
  }
  mask.fill(0);
  let cnt = 0;
  for (let b = 0; b < XNB; b++) {
    if (bState[b] !== 2 || !bD[b].blend) continue;
    const x0 = (b % XBW) * XB, y0 = ((b / XBW) | 0) * XB, bh = Math.min(XB, XH - y0);
    for (let r = 0; r < bh; r++) for (let c = 0; c < XB; c++) { const i = (y0 + r) * XW + x0 + c; if (isDiff(f[A0 + i] - f[B0 + i])) { mask[i] = 1; cnt++; } }
  }
  return cnt / XN;
}

/* the share of the frame the mask covers once gaps up to 2r px are closed (dilate, then erode, by a square) */
const mt1 = new Uint8Array(XN), mt2 = new Uint8Array(XN);
function closedShare(m, r) {
  const pass = (src, dst, horiz, dilate) => {
    for (let y = 0; y < XH; y++) for (let x = 0; x < XW; x++) {
      let v = dilate ? 0 : 1;
      for (let t = -r; t <= r; t++) {
        const xx = horiz ? x + t : x, yy = horiz ? y : y + t;
        const s = xx < 0 || xx >= XW || yy < 0 || yy >= XH ? (dilate ? 0 : 1) : src[yy * XW + xx];
        if (dilate ? s : !s) { v = dilate ? 1 : 0; break; }
      }
      dst[y * XW + x] = v;
    }
  };
  pass(m, mt1, true, true); pass(mt1, mt2, false, true); pass(mt2, mt1, true, false); pass(mt1, mt2, false, false);
  let c = 0; for (let i = 0; i < XN; i++) c += mt2[i];
  return c / XN;
}

export async function crossfades(file, blackFlags, srcFps) {
  const FPS = 30;
  const g = await grey(file, { fps: FPS, w: XW, h: XH });
  const f = g.data;
  const nearBlack = (k) => { const s = Math.round((k / FPS) * srcFps); return !!blackFlags[Math.min(blackFlags.length - 1, Math.max(0, s))]; };
  const dark = Array.from({ length: g.n }, (_, k) => nearBlack(k));
  const hit = new Array(g.n).fill(null);
  for (let k = 3; k < g.n - 3; k++) {
    const cands = [];
    for (const w of [3, 5, 8, 12]) {
      if (k - w < 0 || k + w >= g.n) continue;
      if (dark.slice(k - w, k + w + 1).some(Boolean)) continue;
      const A = (k - w) * XN, B = (k + w) * XN, F = k * XN;
      let sdd = 0, sfd = 0, cnt = 0;
      for (let i = 0; i < XN; i++) { const d = f[A + i] - f[B + i]; if (isDiff(d)) { sdd += d * d; sfd += (f[F + i] - f[B + i]) * d; cnt++; } }
      const area = cnt / XN;
      if (area < 0.02 || sdd === 0) continue;
      const a = sfd / sdd;
      if (a < 0.15 || a > 0.85) continue;
      let se = 0;
      for (let i = 0; i < XN; i++) { const d = f[A + i] - f[B + i]; if (isDiff(d)) { const e = f[F + i] - f[B + i] - a * d; se += e * e; } }
      const r = Math.sqrt(se / sdd);
      if (r < 0.3) cands.push({ a, r, area, w });
    }
    cands.sort((x, y) => x.r - y.r);
    for (const c of cands) {
      const px = blendNotMotion(f, k, c.w, c.a);
      if (px >= 0.02) { hit[k] = { r: c.r, differing: c.area, pixels: px, area: closedShare(mask, 3) }; break; }
    }
  }
  const max = (seg, key) => Math.max(...seg.map((s) => s[key]));
  return runs(hit.map(Boolean)).filter(([a, b]) => b - a >= 3 || (b - a >= 2 && max(hit.slice(a, b), 'area') >= XF_AREA)).map(([a, b]) => {
    const seg = hit.slice(a, b);
    return { at: round(a / FPS, 2), until: round(b / FPS, 2), seconds: round((b - a) / FPS, 2), area: round(max(seg, 'area'), 3), residual: round(Math.min(...seg.map((s) => s.r)), 3), blendPixels: round(max(seg, 'pixels'), 3), differing: round(max(seg, 'differing'), 3) };
  });
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
