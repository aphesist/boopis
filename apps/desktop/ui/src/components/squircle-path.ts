/* Apple's continuous corners as SVG path data: the pure math of `squircle` (no DOM).

   Figma's corner smoothing, ported from figma-squircle (MIT licence, Copyright (c) 2021 Tien Pham,
   github.com/phamfoo/figma-squircle), which follows Daniel Furse, "Desperately seeking squircles" (Figma, 2018).
   A corner of radius R with smoothing ξ (0.6, as iOS) keeps a circular arc of 90(1 − ξ) degrees in its middle and
   replaces each end with a cubic, so the curvature eases in from zero at the straight edge; the corner runs
   (1 + ξ)·R along each edge. Where an edge is too short for that run, ξ shrinks first (a corner never passes the
   middle of an edge). The numbers are the v6 reference's (`design/v6/components/components.js`, the golden paths in
   `squircle-path.test.ts` are its output). */

export const DEFAULT_SMOOTHING = 0.6;
const RAD = Math.PI / 180;
/** coordinates are written with two decimals, as the reference does */
const n = (x: number): string => String(Math.round(x * 100) / 100);

export interface CornerParams { a: number; b: number; c: number; d: number; p: number; arc: number; r: number }

/** figma-squircle's getPathParamsForCorner, preserveSmoothing off. `budget` is the room the corner has along an edge. */
export function cornerParams(r: number, smoothing: number, budget: number): CornerParams | null {
  if (!(r > 0)) return null;
  let p = (1 + smoothing) * r;
  const sm = Math.min(smoothing, budget / r - 1);
  p = Math.min(p, budget);
  const arcMeasure = 90 * (1 - sm);
  const arc = Math.sin(arcMeasure / 2 * RAD) * r * Math.SQRT2;
  const alpha = (90 - arcMeasure) / 2;
  const p3p4 = r * Math.tan(alpha / 2 * RAD);
  const beta = 45 * sm;
  const c = p3p4 * Math.cos(beta * RAD);
  const d = c * Math.tan(beta * RAD);
  const b = (p - arc - c - d) / 3;
  return { a: 2 * b, b, c, d, p, arc, r };
}

/** one corner, in relative commands, from the current point: (ux, uy) is the direction in, (vx, vy) the direction out (unit vectors) */
export function cornerSegment(q: CornerParams | null, ux: number, uy: number, vx: number, vy: number): string {
  if (!q) return '';
  const pt = (pu: number, pv: number): string => n(pu * ux + pv * vx) + ' ' + n(pu * uy + pv * vy);
  const { a, b, c, d, arc, r } = q;
  return 'c' + pt(a, 0) + ' ' + pt(a + b, 0) + ' ' + pt(a + b + c, d) +
    'a' + n(r) + ' ' + n(r) + ' 0 0 ' + (ux * vy - uy * vx > 0 ? 1 : 0) + ' ' + pt(arc, arc) +
    'c' + pt(d, c) + ' ' + pt(d, b + c) + ' ' + pt(d, a + b + c);
}

/* A corner's commands are relative, so they depend only on its radius, the smoothing, the turn and (when the edge is
   too short for the full run) the budget: cached, so a resize only rebuilds the four straight edges. */
const DIRS: ReadonlyArray<readonly [number, number, number, number]> = [[0, -1, 1, 0], [1, 0, 0, 1], [0, 1, -1, 0], [-1, 0, 0, -1]];   /* tl, tr, br, bl */
const NONE: readonly [string, number] = ['', 0];
const segCache = new Map<string, readonly [string, number]>();
const SEG_CACHE_MAX = 4000;
export const segCacheSize = (): number => segCache.size;
export const clearSegCache = (): void => { segCache.clear(); };

function corner(r: number, smoothing: number, budget: number, dir: number): readonly [string, number] {
  const rr = Math.min(Math.max(0, r), budget);
  if (!(rr > 0)) return NONE;
  const key = rr + '|' + smoothing + '|' + ((1 + smoothing) * rr <= budget ? '' : budget) + '|' + dir;
  let v = segCache.get(key);
  if (!v) {
    const q = cornerParams(rr, smoothing, budget), D = DIRS[dir] ?? [0, -1, 1, 0] as const;
    v = [cornerSegment(q, D[0], D[1], D[2], D[3]), q ? q.p : 0];
    if (segCache.size > SEG_CACHE_MAX) segCache.clear();
    segCache.set(key, v);
  }
  return v;
}

export interface PathOpts { smoothing?: number; x?: number; y?: number }
export type Radii = number | readonly [tl: number, tr: number, br: number, bl: number];

/** the outline of a w×h box with continuous corners: the radii are [top-left, top-right, bottom-right, bottom-left] or one for all */
export function squirclePath(w: number, h: number, r: Radii, o?: PathOpts): string {
  const sm = o?.smoothing ?? DEFAULT_SMOOTHING, x = o?.x ?? 0, y = o?.y ?? 0;
  const R = typeof r === 'number' ? [r, r, r, r] as const : r;
  const budget = Math.min(w, h) / 2;
  const tl = corner(R[0], sm, budget, 0), tr = corner(R[1], sm, budget, 1), br = corner(R[2], sm, budget, 2), bl = corner(R[3], sm, budget, 3);
  return 'M' + n(x + w - tr[1]) + ' ' + n(y) + tr[0] + 'L' + n(x + w) + ' ' + n(y + h - br[1]) + br[0] +
    'L' + n(x + bl[1]) + ' ' + n(y + h) + bl[0] + 'L' + n(x) + ' ' + n(y + tl[1]) + tl[0] + 'Z';
}

export interface CornerOpt { smoothing?: number; round?: boolean }

/** a corner between two straight edges meeting at (cx, cy), from the current point (ax, ay) to (bx, by): its run is
    |a − c|, so its radius is run / (1 + ξ). Convex or concave: the turn's direction picks the arc's sweep. */
export function cornerTo(ax: number, ay: number, cx: number, cy: number, bx: number, by: number, o?: CornerOpt): string {
  const sm = o?.round ? 0 : (o?.smoothing ?? DEFAULT_SMOOTHING);
  const run = Math.hypot(cx - ax, cy - ay);
  if (!run) return 'L' + n(bx) + ' ' + n(by);
  const ux = (cx - ax) / run, uy = (cy - ay) / run, vl = Math.hypot(bx - cx, by - cy) || 1, vx = (bx - cx) / vl, vy = (by - cy) / vl;
  return cornerSegment(cornerParams(run / (1 + sm), sm, run), ux, uy, vx, vy);
}

export interface SlabOpt extends CornerOpt { x?: number }

/** The dock's slab in the coordinates the dock engine uses: the body spans x ∈ [x, x + w] (x defaults to F), the floor
    is y = h; concave flares of run F out of the floor, top corners of radius R; `{round: true}` for a pill's round ends. */
export function slabPath(w: number, h: number, R: number, F: number, o?: SlabOpt): string {
  const sm = o?.round ? 0 : (o?.smoothing ?? DEFAULT_SMOOTHING);
  const x0 = o?.x ?? F, x1 = x0 + w;
  const top = cornerParams(Math.min(R, w / 2), sm, Math.max(0, Math.min(w / 2, h - F)));
  const pt = top ? top.p : 0;
  return 'M' + n(x0 - F) + ' ' + n(h) + (F > 0 ? cornerTo(x0 - F, h, x0, h, x0, h - F, o) : '') +
    'L' + n(x0) + ' ' + n(pt) + cornerSegment(top, 0, -1, 1, 0) + 'L' + n(x1 - pt) + ' 0' + cornerSegment(top, 1, 0, 0, 1) +
    'L' + n(x1) + ' ' + n(h - F) + (F > 0 ? cornerTo(x1, h - F, x1, h, x1 + F, h, o) : '') + 'Z';
}

/** the concave corner (the outside of a corner, a flare): a sz×sz square minus a continuous corner, at its top-right or top-left */
export function concavePath(size: number, at: 'tr' | 'tl'): string {
  return at === 'tr'
    ? 'M' + n(size) + ' 0L0 0' + cornerTo(0, 0, size, 0, size, size) + 'Z'
    : 'M0 0L' + n(size) + ' 0' + cornerTo(size, 0, 0, 0, 0, size) + 'Z';
}
