/* A small, exact PNG decoder for the renderer: Chrome's screenshots are 8-bit RGB or RGBA, non-interlaced, and with
   `optimizeForSpeed` mostly unfiltered at zlib level 1, so decoding is one inflate and a row copy. Every filter type is
   handled (a slower path), so any 8-bit PNG decodes. Returns RGB (alpha dropped: the film's frames are opaque). */
import { inflateSync } from 'node:zlib';

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];

export function decodePNG(buf) {
  for (let i = 0; i < 8; i++) if (buf[i] !== SIG[i]) throw new Error('png: not a PNG');
  let off = 8, w = 0, h = 0, depth = 0, ctype = 0, interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; interlace = data[12]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (depth !== 8 || interlace !== 0 || (ctype !== 2 && ctype !== 6)) throw new Error('png: unsupported format (depth ' + depth + ', colour type ' + ctype + ', interlace ' + interlace + ')');
  const bpp = ctype === 6 ? 4 : 3, stride = w * bpp;
  const raw = inflateSync(idat.length === 1 ? idat[0] : Buffer.concat(idat));
  const out = Buffer.allocUnsafe(w * h * 3);
  let prev = Buffer.alloc(stride), cur = Buffer.allocUnsafe(stride);
  for (let y = 0; y < h; y++) {
    const ro = y * (stride + 1), f = raw[ro];
    const src = raw.subarray(ro + 1, ro + 1 + stride);
    if (f === 0) src.copy(cur);
    else if (f === 1) { for (let i = 0; i < stride; i++) cur[i] = (src[i] + (i >= bpp ? cur[i - bpp] : 0)) & 255; }
    else if (f === 2) { for (let i = 0; i < stride; i++) cur[i] = (src[i] + prev[i]) & 255; }
    else if (f === 3) { for (let i = 0; i < stride; i++) cur[i] = (src[i] + (((i >= bpp ? cur[i - bpp] : 0) + prev[i]) >> 1)) & 255; }
    else if (f === 4) {
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        cur[i] = (src[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    } else throw new Error('png: bad filter ' + f);
    const o = y * w * 3;
    if (bpp === 3) cur.copy(out, o);
    else for (let x = 0, i = 0, j = o; x < w; x++, i += 4, j += 3) { out[j] = cur[i]; out[j + 1] = cur[i + 1]; out[j + 2] = cur[i + 2]; }
    const t = prev; prev = cur; cur = t;
  }
  return { width: w, height: h, rgb: out };
}
