export const BAYER_8: readonly number[] = [
  0, 48, 12, 60, 3, 51, 15, 63,
  32, 16, 44, 28, 35, 19, 47, 31,
  8, 56, 4, 52, 11, 59, 7, 55,
  40, 24, 36, 20, 43, 27, 39, 23,
  2, 50, 14, 62, 1, 49, 13, 61,
  34, 18, 46, 30, 33, 17, 45, 29,
  10, 58, 6, 54, 9, 57, 5, 53,
  42, 26, 38, 22, 41, 25, 37, 21,
];

function hash2(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

export function fbm(x: number, y: number): number {
  let v = 0;
  let amp = 0.55;
  let px = x;
  let py = y;
  for (let i = 0; i < 4; i++) {
    v += amp * valueNoise(px, py);
    px = px * 2.02 + 1.7;
    py = py * 2.01 - 1.2;
    amp *= 0.5;
  }
  return v;
}

export function paintBayerSmoke(
  canvas: HTMLCanvasElement,
  t: number,
  power = 1.0,
): void {
  if (canvas.offsetParent === null) return;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  const img = ctx.createImageData(w, h);
  const d = img.data;

  for (let y = 0; y < h; y++) {
    const ny = y / h;
    const falloff = Math.pow(Math.max(0, 1 - ny * 1.08), 1.48);
    for (let x = 0; x < w; x++) {
      const nx = x / w;
      const warp = fbm(nx * 3.8 + t * 0.7, ny * 2.5 - t * 0.4);
      const plume = fbm(nx * 5.2 - t * 0.35 + warp * 1.25, ny * 3.2 + warp * 0.85);
      const wave = 0.15 * Math.sin(nx * 6.2 + t * 1.05) + 0.11 * Math.cos(nx * 10.5 - t * 0.75);
      const tone = Math.min(1, Math.max(0, (plume * 1.16 + wave + 0.12) * falloff * power));
      const th = (BAYER_8[(y & 7) * 8 + (x & 7)] + 0.5) / 64.0;
      const on = tone > th ? 255 : 0;
      const idx = (y * w + x) * 4;
      d[idx] = on;
      d[idx + 1] = on;
      d[idx + 2] = on;
      d[idx + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
}
