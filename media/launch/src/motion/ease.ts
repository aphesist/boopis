/* The film's curves: craft bible part 3, exactly. Every ease here is a function of progress p in [0, 1] that returns
   exactly 0 at p = 0 and exactly 1 at p = 1 (a curve solved numerically can return 1e-9 at the ends, and a guard
   like `if (v > 0)` then fires a frame early). Each carries `easeName`, which the craft checker reads.

     arrive  expo-out          anything entering and coming to rest                 24 to 40 f
     travel  quint in-out      A to B with both ends on screen: morphs, camera      24 to 48 f
     snap    strong in-out     whip pans, zoom-throughs, big-word shrinks (+ blur)  12 to 24 f
     depart  quart-in          leaving the frame for good (0.6 to 0.7x the entry)   10 to 20 f
     ui      the app's --ease  anything the real app animates, faithfully
     uiSpring the app's --spring
     linear  only for constant motion that never starts or stops on screen (a drift, a ticker), tagged so */

export type Ease = ((p: number) => number) & { easeName: string };

const named = (name: string, f: (p: number) => number): Ease => {
  const e = ((p: number): number => (p <= 0 ? 0 : p >= 1 ? 1 : f(p))) as Ease;
  e.easeName = name;
  return e;
};

/** a CSS cubic-bezier(x1, y1, x2, y2) as an exact-ended function (Newton, then bisection) */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number, name = 'cubic-bezier(' + [x1, y1, x2, y2].join(', ') + ')'): Ease {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t: number): number => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number): number => ((ay * t + by) * t + cy) * t;
  const dx = (t: number): number => (3 * ax * t + 2 * bx) * t + cx;
  const solve = (x: number): number => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x;
      if (Math.abs(e) < 1e-7) return t;
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    let lo = 0, hi = 1; t = x;
    for (let i = 0; i < 40; i++) { const v = sx(t); if (Math.abs(v - x) < 1e-7) break; if (v < x) lo = t; else hi = t; t = (lo + hi) / 2; }
    return t;
  };
  return named(name, (p) => sy(solve(p)));
}

export const arrive = cubicBezier(0.16, 1, 0.3, 1, 'arrive');
export const travel = cubicBezier(0.83, 0, 0.17, 1, 'travel');
export const snap = cubicBezier(0.87, 0, 0.13, 1, 'snap');
export const depart = cubicBezier(0.5, 0, 0.75, 0, 'depart');
export const ui = cubicBezier(0.2, 0.8, 0.2, 1, 'ui');
export const uiSpring = cubicBezier(0.22, 1, 0.36, 1, 'ui-spring');
/** constant motion only (never on something that starts or stops on screen); tweens using it must say `data: { linear: true }` */
export const linear = named('linear', (p) => p);

/** orb2's blink curve over the blink's 0.155 s: closed at the middle (pow(sin(pi p), 0.82)); it starts and ends at 0 */
export const blinkCurve: Ease = (() => {
  const e = ((p: number): number => (p <= 0 || p >= 1 ? 0 : Math.pow(Math.sin(p * Math.PI), 0.82))) as Ease;
  e.easeName = 'orb-blink';
  return e;
})();

export const EASES = { arrive, travel, snap, depart, ui, uiSpring, linear } as const;
export type EaseName = keyof typeof EASES;
