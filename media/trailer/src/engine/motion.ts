/* Motion for the trailer: the app's own curves and springs, as pure functions of time (seconds), so every frame is a
   function of the clock and a render is deterministic. --ease, --spring and --ease-io are the tokens' cubic-beziers
   (DESIGN-SYSTEM 11); `damped` is the dock's critically damped spring (omega 22, settles in about 300 ms). */
export const clamp = (v: number, a = 0, b = 1): number => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, p: number): number => a + (b - a) * p;
export const mix = (a: number, b: number, p: number): number => a + (b - a) * clamp(p);

/** a CSS cubic-bezier as a function of x in 0..1 */
export function bezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t: number): number => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number): number => ((ay * t + by) * t + cy) * t;
  const dx = (t: number): number => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number): number => {
    if (x <= 0) return 0; if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) { const e = sx(t) - x, d = dx(t); if (Math.abs(e) < 1e-6 || Math.abs(d) < 1e-6) break; t -= e / d; }
    let lo = 0, hi = 1;
    for (let i = 0; i < 30 && Math.abs(sx(t) - x) > 1e-6; i++) { if (sx(t) < x) lo = t; else hi = t; t = (lo + hi) / 2; }
    return sy(t);
  };
}
export const EASE = bezier(0.2, 0.8, 0.2, 1);
export const SPRING = bezier(0.22, 1, 0.36, 1);
export const EASE_IO = bezier(0.65, 0, 0.35, 1);
export const LINEAR = (x: number): number => clamp(x);

/** progress of a step that starts at `at` and lasts `dur` seconds, eased */
export const step = (t: number, at: number, dur: number, ease: (x: number) => number = SPRING): number => ease(clamp((t - at) / dur));
/** the critically damped spring's position (0 to 1) `s` seconds after it starts */
export const damped = (s: number, omega = 22): number => (s <= 0 ? 0 : 1 - (1 + omega * s) * Math.exp(-omega * s));
/** in, hold, out: 0 before `a`, rises over `din`, holds, falls over `dout` ending at `b` */
export function window_(t: number, a: number, b: number, din = 0.5, dout = 0.2, ein = SPRING, eout = EASE): number {
  if (t < a || t > b) return 0;
  const i = ein(clamp((t - a) / din)), o = 1 - eout(clamp((t - (b - dout)) / dout));
  return Math.min(i, o);
}
/** a small deterministic hash noise in -1..1 */
export const noise = (n: number): number => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return (s - Math.floor(s)) * 2 - 1; };
