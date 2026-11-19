/* Springs, as data the compositor can play (ADR-0025). The design system's dock springs are critically damped
   (DESIGN-SYSTEM.md section 11: omega about 22, settles in about 300 ms, keeps its velocity when interrupted). Their
   closed form is sampled here into a piecewise-linear curve, so a spring can run as a Web Animation or as a CSS
   `linear()` easing instead of per-frame JavaScript: the compositor thread evaluates it, and a busy main thread cannot
   drop a frame of it.

   One spring is `x'' = -k x - c x'` toward 0 with `c = 2 z sqrt(k)` (unit mass), the same law `dock/ctx.ts` integrates
   for the motion that must follow the pointer live. `springAt` is its exact solution for any starting offset and
   velocity, which is what lets an interrupted animation hand its velocity to the next one without reading the page.

   Two ways to play a sampled spring:
   - `springKeyframes`: explicit keyframes, easing `linear` between them. Each channel (x, y, scale...) has its own
     start offset and velocity, so one animation carries them all. It accelerates in every engine version.
   - `springLinear`: a normalised 0 to 1 curve as a `linear()` string, for a CSS transition or a one-channel animation
     that starts at rest. WebKitGTK before 2.54 runs `linear()` with points on the main thread, which is why the dock
     uses keyframes (docs/research/120hz.md section 2). */

export interface SpringParams { k: number; z?: number }
export interface SpringState { x: number; v: number }
/** one animated quantity: its offset from rest, its velocity, and how close to rest counts as rest (0.05 for pixels) */
export interface Channel { x0: number; v0?: number; eps?: number }

const damping = (p: SpringParams): number => p.z ?? 1;
const near1 = (z: number): boolean => Math.abs(z - 1) < 1e-6;

/** the exact state `t` seconds after the spring was at offset `x0` with velocity `v0`, heading for 0 */
export function springAt(p: SpringParams, x0: number, v0: number, t: number): SpringState {
  if (t <= 0) return { x: x0, v: v0 };
  const w = Math.sqrt(p.k), z = damping(p);
  if (near1(z)) {
    const B = v0 + w * x0, e = Math.exp(-w * t);
    return { x: (x0 + B * t) * e, v: (B - w * (x0 + B * t)) * e };
  }
  if (z < 1) {
    const wd = w * Math.sqrt(1 - z * z), a = z * w, B = (v0 + a * x0) / wd, e = Math.exp(-a * t), c = Math.cos(wd * t), s = Math.sin(wd * t);
    return { x: e * (x0 * c + B * s), v: e * ((wd * B - a * x0) * c + (-a * B - wd * x0) * s) };
  }
  const r = w * Math.sqrt(z * z - 1), r1 = -w * z + r, r2 = -w * z - r;
  const C2 = (v0 - r1 * x0) / (r2 - r1), C1 = x0 - C2, e1 = Math.exp(r1 * t), e2 = Math.exp(r2 * t);
  return { x: C1 * e1 + C2 * e2, v: C1 * r1 * e1 + C2 * r2 * e2 };
}

/** seconds until the spring is within `eps` of rest (position) and `4 eps` per second (velocity) for good: the same rest
    test the dock's live springs use (`atRest`) */
export function settleTime(p: SpringParams, x0: number, v0 = 0, eps = 0.05): number {
  const w = Math.sqrt(p.k), z = damping(p);
  const rate = z >= 1 ? w * (z - Math.sqrt(Math.max(0, z * z - 1))) || w : z * w;     /* the slowest decay */
  const step = 1 / 240, cap = Math.max(1, 12 / rate);
  let last = 0;
  for (let t = 0; t < cap; t += step) {
    const s = springAt(p, x0, v0, t);
    if (Math.abs(s.x) >= eps || Math.abs(s.v) >= eps * 4) last = t + step;
  }
  return last;
}

export interface Sampled {
  /** seconds from the start to rest */
  duration: number;
  /** stop positions in 0..1 of the duration, ascending, first 0 and last 1 */
  offsets: number[];
  /** one array of values per channel, a value per offset (the last is exactly 0: at rest) */
  values: number[][];
}
export interface SampleOpts { tol?: number; eps?: number; maxStops?: number }

/** sample channels of one spring (each with its own offset and velocity) into stops so that the piecewise-linear curve
    stays within `tol` (default 0.2%) of the exact one, measured against each channel's own amplitude. The stops are the
    union over the channels, refined where the curve bends. */
export function sampleSprings(p: SpringParams, channels: readonly Channel[], o: SampleOpts = {}): Sampled {
  const tol = o.tol ?? 0.002, maxStops = o.maxStops ?? 160, w = Math.sqrt(p.k);
  const chans = channels.map((c) => ({ x0: c.x0, v0: c.v0 ?? 0, eps: c.eps ?? o.eps ?? 0.05 }));
  const dur = Math.max(...chans.map((c) => settleTime(p, c.x0, c.v0, c.eps)), 0);
  if (dur <= 0) return { duration: 0, offsets: [0, 1], values: chans.map(() => [0, 0]) };
  const scale = chans.map((c) => Math.max(Math.abs(c.x0), Math.abs(c.v0) / w, c.eps));
  const at = (t: number): number[] => chans.map((c) => springAt(p, c.x0, c.v0, t).x);
  const ts: number[] = [], vals: number[][] = [];
  const N = 12;
  for (let i = 0; i <= N; i++) { ts.push(dur * i / N); vals.push(at(dur * i / N)); }
  vals[N] = chans.map(() => 0);
  /* refine every interval whose midpoint is off the chord by more than the tolerance */
  for (let pass = 0; pass < 8 && ts.length < maxStops; pass++) {
    const nt: number[] = [], nv: number[][] = [];
    for (let i = 0; i < ts.length - 1 && ts.length + nt.length < maxStops; i++) {
      const a = ts[i] as number, b = ts[i + 1] as number, m = (a + b) / 2, ex = at(m), va = vals[i] as number[], vb = vals[i + 1] as number[];
      let bad = false;
      for (let c = 0; c < chans.length; c++) if (Math.abs((ex[c] as number) - ((va[c] as number) + (vb[c] as number)) / 2) > tol * (scale[c] as number)) { bad = true; break; }
      if (bad) { nt.push(m); nv.push(ex); }
    }
    if (!nt.length) break;
    for (let i = 0; i < nt.length; i++) { ts.push(nt[i] as number); vals.push(nv[i] as number[]); }
    const order = ts.map((_, i) => i).sort((x, y) => (ts[x] as number) - (ts[y] as number));
    const st = order.map((i) => ts[i] as number), sv = order.map((i) => vals[i] as number[]);
    ts.length = 0; vals.length = 0; ts.push(...st); vals.push(...sv);
  }
  return { duration: dur, offsets: ts.map((t, i) => (i === 0 ? 0 : i === ts.length - 1 ? 1 : Math.min(1, Math.max(0, t / dur)))), values: chans.map((_, c) => vals.map((v) => v[c] as number)) };
}

const f = (n: number, d: number): string => { const s = (+n.toFixed(d)).toString(); return s === '-0' ? '0' : s; };

/** the normalised progress curve of a spring that starts at rest one unit away and settles at 0, as the points of a
    CSS `linear()` easing: output 0 at the start and 1 at rest. `duration` is in milliseconds. */
export function springLinear(p: SpringParams, o: SampleOpts = {}): { easing: string; duration: number; stops: Array<[number, number]> } {
  const s = sampleSprings(p, [{ x0: 1 }], { eps: 5e-4, ...o });   /* 0.05 px of a 100 px travel */
  const stops = s.offsets.map((t, i): [number, number] => [1 - (s.values[0] as number[])[i]!, t]);
  stops[stops.length - 1] = [1, 1];
  const body = stops.map(([v, t], i) => (i === 0 ? f(v, 4) : i === stops.length - 1 ? f(v, 4) : `${f(v, 4)} ${f(t * 100, 2)}%`)).join(', ');
  return { easing: `linear(${body})`, duration: s.duration * 1000, stops };
}

/** evaluate a `linear()` point list at progress `t` in 0..1 (what the engine does with the string) */
export function evalLinear(stops: ReadonlyArray<readonly [number, number]>, t: number): number {
  if (t <= 0) return stops[0]![0];
  for (let i = 1; i < stops.length; i++) {
    const [v1, t1] = stops[i]!, [v0, t0] = stops[i - 1]!;
    if (t <= t1) return t1 === t0 ? v1 : v0 + (v1 - v0) * (t - t0) / (t1 - t0);
  }
  return stops[stops.length - 1]![0];
}

export interface SpringPlay { keyframes: Keyframe[]; duration: number }
/** keyframes for channels that spring to rest: `make` turns the channel values at a stop into one keyframe (for
    example `{ transform: translate(...) scale(...) }`). Play them with `easing: 'linear'` and `duration`. */
export function springKeyframes(p: SpringParams, channels: readonly Channel[], make: (values: number[]) => Keyframe, o?: SampleOpts): SpringPlay {
  const s = sampleSprings(p, channels, o);
  const keyframes = s.offsets.map((t, i) => ({ ...make(s.values.map((c) => c[i] as number)), offset: t }));
  return { keyframes, duration: s.duration * 1000 };
}

/** where an animation started by `springKeyframes` is now: the elapsed animation time in ms, or null before it has begun */
export const springElapsed = (a: { currentTime: CSSNumberish | null }, delay = 0): number => {
  const t = typeof a.currentTime === 'number' ? a.currentTime : 0;     /* engines report ms as a number */
  return Math.max(0, t - delay);
};
