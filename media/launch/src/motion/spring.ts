/* Springs in closed form (craft bible part 3): a damped harmonic oscillator, mass 1, released from rest at 0 toward 1.
   No integration and no state, so a spring is a pure function of time like everything else in the film.

     settle     k 300, c 30, ratio 0.87, ~0.4% overshoot   default scale-ins of cards and chips, the cursor's release
     camera     k 170, c 26, ratio 1.0, no overshoot       camera follow and push; never overshoots
     character  k 400, c 22, ratio 0.55, ~13% overshoot    the mark and the bots' faces only: blinks, glances, playful letters

   As a GSAP ease a spring needs a duration: `springDuration(name)` is the time it takes to come within 0.1% of rest and
   stay there; the ease then ends exactly at 1. */
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

/** a spring as an ease over `duration` seconds (default: its settling time); exact 0 and 1 at the ends */
export function springEase(def: SpringDef | SpringName, duration?: number): Ease {
  const d: SpringDef = typeof def === 'string' ? SPRINGS[def] : def;
  const T = duration ?? springDuration(d);
  const e = ((p: number): number => (p <= 0 ? 0 : p >= 1 ? 1 : springAt(d, p * T).x)) as Ease;
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
