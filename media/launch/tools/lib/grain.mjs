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

export function grainer({ seed, alpha }, scale) {
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
