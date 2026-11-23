/* Springs in closed form (craft bible part 3): a damped harmonic oscillator, mass 1, released from rest at 0 toward 1.
   No integration and no state, so a spring is a pure function of time like everything else in the film.

     settle     k 300, c 30, ratio 0.87, ~0.4% overshoot   default scale-ins of cards and chips, the cursor's release
     camera     k 170, c 26, ratio 1.0, no overshoot       camera follow and push; never overshoots
     character  k 400, c 22, ratio 0.55, ~13% overshoot    the mark and the bots' faces only: blinks, glances, playful letters

   As a GSAP ease a spring needs a duration: `springDuration(name)` is the time it takes to come within 0.1% of rest and
   stay there; the ease closes that last 0.1% smoothly, so it lands exactly at 1 with zero velocity (springEase). */
import type { Ease } from './ease';

export interface SpringDef { stiffness: number; damping: number; mass?: number }
export const SPRINGS = {
  settle: { stiffness: 300, damping: 30 },
  camera: { stiffness: 170, damping: 26 },
  character: { stiffness: 400, damping: 22 }
} as const satisfies Record<string, SpringDef>;
export type SpringName = keyof typeof SPRINGS;

/** position at time t (seconds) of a spring from 0 to 1, and its velocity */
export function springAt(def: SpringDef, t: number): { x: number; v: number } {
  const m = def.mass ?? 1, w0 = Math.sqrt(def.stiffness / m), z = def.damping / (2 * Math.sqrt(def.stiffness * m));
  if (t <= 0) return { x: 0, v: 0 };
  if (z < 1) {
    const wd = w0 * Math.sqrt(1 - z * z), e = Math.exp(-z * w0 * t);
    const c = Math.cos(wd * t), s = Math.sin(wd * t);
    const x = 1 - e * (c + (z * w0 / wd) * s);
    const v = e * (w0 * w0 / wd) * s;
    return { x, v };
  }
  if (z === 1) { const e = Math.exp(-w0 * t); return { x: 1 - e * (1 + w0 * t), v: e * w0 * w0 * t }; }
  const r1 = -w0 * (z - Math.sqrt(z * z - 1)), r2 = -w0 * (z + Math.sqrt(z * z - 1));
  const A = r2 / (r2 - r1), B = -r1 / (r2 - r1);
  return { x: 1 - A * Math.exp(r1 * t) - B * Math.exp(r2 * t), v: -A * r1 * Math.exp(r1 * t) - B * r2 * Math.exp(r2 * t) };
}

/** seconds until the spring stays within `tol` of rest */
export function springDuration(def: SpringDef | SpringName, tol = 0.001): number {
  const d: SpringDef = typeof def === 'string' ? SPRINGS[def] : def;
  let last = 0;
  for (let t = 0; t < 5; t += 1 / 600) { if (Math.abs(1 - springAt(d, t).x) > tol || Math.abs(springAt(d, t).v) > tol * 20) last = t; }
  return Math.ceil(last * 60) / 60;
}

/** a spring as an ease over `duration` seconds of spring time (default: its settling time), landing EXACTLY at rest.

    The closed form never quite arrives: at its settling time it is still up to 0.1% short (1 px of a 1000 px camera
    move) and still moving, so an ease that jumped to 1 at the end popped. Here the last stretch is closed by a smooth
    correction (zero at the start with zero slope, so the start is the spring's own) that takes away both the remaining
    distance and the remaining velocity: the ease is 1 with zero velocity at p = 1, and continuous everywhere.

    A duration shorter than the spring's settling time used to cut it off mid-flight (a jump, and a sudden stop): a
    spring cannot settle faster than it settles, so asked to, it is now played whole, faster (time-scaled into the
    duration). A longer duration lets it settle and then rest. */
export function springEase(def: SpringDef | SpringName, duration?: number): Ease {
  const d: SpringDef = typeof def === 'string' ? SPRINGS[def] : def;
  const settle = springDuration(d);
  const T = duration == null ? settle : Math.max(duration, settle);
  const end = springAt(d, T);
  const r = 1 - end.x, vT = end.v * T;              /* the distance and the velocity (per unit of p) left at p = 1 */
  const e = ((p: number): number => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    const p2 = p * p, p3 = p2 * p;
    return springAt(d, p * T).x + r * (3 * p2 - 2 * p3) - vT * (p3 - p2);
  }) as Ease;
  e.easeName = 'spring:' + (typeof def === 'string' ? def : d.stiffness + '/' + d.damping);
  return e;
}

/** damping ratio, overshoot and settling time of a spring (the numbers the craft bible quotes) */
export function springStats(def: SpringDef | SpringName): { ratio: number; overshoot: number; settle: number } {
  const d: SpringDef = typeof def === 'string' ? SPRINGS[def] : def;
  const ratio = d.damping / (2 * Math.sqrt(d.stiffness * (d.mass ?? 1)));
  let peak = 0;
  for (let t = 0; t < 3; t += 1 / 1200) peak = Math.max(peak, springAt(d, t).x);
  return { ratio, overshoot: Math.max(0, peak - 1), settle: springDuration(d, 0.02) };
}
