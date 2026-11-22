/* The ground's grain, added by the renderer to each finished frame: the same six 256 px tiles from the same seed as
   the page's own grain (src/engine/ground.ts), white at alpha u x strength over the frame, one tile cell per 1080p px
   (2 output px at 4K: every value doubles). Frame n uses tile n mod 6 at offset n mod 64. Deterministic. */
const S = 256, N = 6;

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* the look's grain (look/src/stage.ts grain()): per CSS px, v = 128 + (r() + r() - 1) x amp from mulberry32(seed) in
   reading order over the whole stage, blended soft-light (the W3C formula, in sRGB as the browser composites) at
   `opacity`. Six variants (seed .. seed + 5) cycle by frame, so the grain lives; a 64K-entry table does the blend. */
function lookGrainer({ seed, opacity = 0.55, amp = 46 }, scale, W, H) {
  const cw = Math.round(W / scale), ch = Math.round(H / scale);
  const variants = Array.from({ length: N }, (_, k) => {
    const r = rng(seed + k), v = new Uint8Array(cw * ch);
    for (let i = 0; i < v.length; i++) v[i] = Math.max(0, Math.min(255, Math.round(128 + (r() + r() - 1) * amp)));
    return v;
  });
  const lut = new Uint8Array(65536);
  for (let b = 0; b < 256; b++) for (let c = 0; c < 256; c++) {
    const cb = b / 255, cs = c / 255;
    const D = cb <= 0.25 ? ((16 * cb - 12) * cb + 4) * cb : Math.sqrt(cb);
    const B = cs <= 0.5 ? cb - (1 - 2 * cs) * cb * (1 - cb) : cb + (2 * cs - 1) * (D - cb);
    lut[(b << 8) | c] = Math.round(255 * ((1 - opacity) * cb + opacity * B));
  }
  const col = new Int32Array(W);
  for (let x = 0; x < W; x++) col[x] = Math.min(cw - 1, Math.floor(x / scale));
  return (rgb, _W, _H, n) => {
    const v = variants[n % N];
    for (let y = 0; y < H; y++) {
      const row = Math.min(ch - 1, Math.floor(y / scale)) * cw;
      for (let x = 0, i = y * W * 3; x < W; x++, i += 3) {
        const g = v[row + col[x]];
        rgb[i] = lut[(rgb[i] << 8) | g]; rgb[i + 1] = lut[(rgb[i + 1] << 8) | g]; rgb[i + 2] = lut[(rgb[i + 2] << 8) | g];
      }
    }
  };
}

export function grainer(spec, scale, W, H) {
  if (spec.kind === 'look') return lookGrainer(spec, scale, W, H);
  return whiteGrainer(spec, scale);
}

function whiteGrainer({ seed, alpha = 0.025 }, scale) {
  const r = rng(seed);
  /* the page stores each value as a byte of alpha; so does this */
  const tiles = Array.from({ length: N }, () => { const t = new Float32Array(S * S); for (let i = 0; i < t.length; i++) t[i] = Math.round(r() * 255) / 255 * alpha; return t; });
  const pos = rng(seed + 1);
  const offsets = Array.from({ length: 64 }, () => [Math.floor(pos() * S), Math.floor(pos() * S)]);
  return (rgb, W, H, n) => {
    const tile = tiles[n % N], [ox, oy] = offsets[n % offsets.length];
    for (let y = 0; y < H; y++) {
      const ty = ((Math.floor(y / scale) - oy) % S + S) % S, row = ty * S;
      let i = y * W * 3;
      for (let x = 0; x < W; x++, i += 3) {
        const a = tile[row + ((Math.floor(x / scale) - ox) % S + S) % S];
        rgb[i] += (255 - rgb[i]) * a + 0.5;
        rgb[i + 1] += (255 - rgb[i + 1]) * a + 0.5;
        rgb[i + 2] += (255 - rgb[i + 2]) * a + 0.5;
      }
    }
  };
}
