/* SVG shape morphs (craft bible T1, T5): one opaque shape becomes another; nothing fades. Built on flubber (MIT,
   (c) 2017 Noah Veltman), which matches the two outlines point by point and can split one shape into several or join
   several into one. GSAP's MorphSVGPlugin is also installed (free, gsap 3.15) for one-to-one morphs that need its
   shapeIndex control; flubber covers everything here.

     morph(film, pathEl, fromD, toD, { at, dur })                  one shape into another
     morphSplit(film, [pathA, pathB], fromD, [toA, toB], { at })   one shape into several (an orb into the mark's eyes)
     morphJoin(film, [pathA, pathB], [fromA, fromB], toD, { at })  several into one (and back)
     orbToMark / markToOrb (orb-moves.ts) use these with orb2's real body and the mark's real eyes.

   Interpolators are built once, at build time; a renderer sets `d` from the tween's progress (a pure function of t).
   Several morphs of one path keep to their windows: the latest started draws (as carries do). */
import { combine, interpolate, separate } from 'flubber';
import type { Film } from '../engine/film';
import { ptsToD, type Pt } from '../engine/orb';
import { travel, type Ease } from './ease';
import { track } from './track';

export type Shape = string | Pt[];
export interface MorphOpts { at: number; dur: number; ease?: Ease; /** px between matched points (smaller is smoother, slower to build) */ resolution?: number; fill?: [string, string] }

const toFl = (s: Shape): string | [number, number][] => (typeof s === 'string' ? s : s.map((p) => [p[0], p[1]] as [number, number]));
export const asD = (s: Shape): string => (typeof s === 'string' ? s : ptsToD(s));


function drive(film: Film, o: MorphOpts): { k: number } {
  const p = { k: 0, __name: 'morph' };
  film.tl.fromTo(p, { k: 0 }, { k: 1, duration: o.dur, ease: o.ease ?? travel, data: { role: 'morph' } }, o.at);
  return p;
}
const setD = (el: SVGPathElement, d: string): void => { if (el.getAttribute('d') !== d) el.setAttribute('d', d); };

/** one shape into another */
export function morph(film: Film, el: SVGPathElement, from: Shape, to: Shape, o: MorphOpts): void {
  const f = interpolate(toFl(from), toFl(to), { maxSegmentLength: o.resolution ?? 3, string: true });
  const p = drive(film, o);
  const a = asD(from), b = asD(to);
  track(film, el, { t0: o.at, draw: () => setD(el, p.k <= 0 ? a : p.k >= 1 ? b : f(p.k)) });
  if (o.fill) film.tl.fromTo(el, { attr: { fill: o.fill[0] } }, { attr: { fill: o.fill[1] }, duration: o.dur, ease: o.ease ?? travel, data: { role: 'morph' } }, o.at);
}

/** one shape into several: els[i] becomes to[i]; at the start every element draws a piece of `from` (together they
    cover it exactly), so nothing appears from nowhere */
export function morphSplit(film: Film, els: SVGPathElement[], from: Shape, to: Shape[], o: MorphOpts): void {
  const fs = separate(toFl(from), to.map(toFl), { maxSegmentLength: o.resolution ?? 3, single: false });
  const p = drive(film, o);
  els.forEach((el, i) => {
    const f = fs[i]!, b = asD(to[i]!);
    track(film, el, { t0: o.at, draw: () => setD(el, p.k >= 1 ? b : f(Math.max(0, p.k))) });
  });
}

/** several shapes into one (the mirror of morphSplit) */
export function morphJoin(film: Film, els: SVGPathElement[], from: Shape[], to: Shape, o: MorphOpts): void {
  const fs = combine(from.map(toFl), toFl(to), { maxSegmentLength: o.resolution ?? 3, single: false });
  const p = drive(film, o);
  els.forEach((el, i) => {
    const f = fs[i]!, a = asD(from[i]!);
    track(film, el, { t0: o.at, draw: () => setD(el, p.k <= 0 ? a : f(Math.min(1, p.k))) });
  });
}
