/* shape: the corner CSS draws, for surfaces drawn as a path (the dock's slab). Where the engine has corner-shape,
   CSS draws superellipse(1.8) corners (--corner); a path drawn with circular arcs would then be rounder than every
   other surface. This draws the same corner as a cubic: the handle length h is set so the curve passes through the
   superellipse's point on the diagonal (h = (4 − 8c) / 3, c = 1 − 2^(−1/n), n = 2^1.8); without corner-shape h is the
   circle's 0.5523, so the path matches the round CSS. */
let cont: boolean | null = null;
export const continuous = (): boolean => (cont ?? (cont = !!(window.CSS && CSS.supports && CSS.supports('corner-shape', 'superellipse(2)'))));
const N = Math.pow(2, 1.8), C = 1 - Math.pow(2, -1 / N);
export const H_CONT = (4 - 8 * C) / 3;
export const H_ROUND = 0.5523;
const handle = (round?: boolean): number => (round || !continuous() ? H_ROUND : H_CONT);
const f = (n: number): string => (+n).toFixed(2);

export interface CornerOpt { round?: boolean }
/** 'C …' from the current point (ax, ay) to (bx, by), whose sharp corner would be (cx, cy). Convex and concave alike. */
export function corner(ax: number, ay: number, cx: number, cy: number, bx: number, by: number, opt?: CornerOpt): string {
  const h = handle(opt?.round);
  return 'C' + f(ax + h * (cx - ax)) + ' ' + f(ay + h * (cy - ay)) + ' ' + f(bx + h * (cx - bx)) + ' ' + f(by + h * (cy - by)) + ' ' + f(bx) + ' ' + f(by);
}
/** the dock's slab path: a concave flare of F out of the floor, the side, the top corners of R, the side and the
    flare back; the body spans x ∈ [F, F + w], the floor is y = h. */
export function slab(w: number, h: number, R: number, F: number, opt?: CornerOpt): string {
  const x0 = F, x1 = F + w, yb = h;
  return 'M0 ' + f(yb) + corner(0, yb, x0, yb, x0, yb - F, opt) + 'V' + f(R) + corner(x0, R, x0, 0, x0 + R, 0, opt) +
    'H' + f(x1 - R) + corner(x1 - R, 0, x1, 0, x1, R, opt) + 'V' + f(yb - F) + corner(x1, yb - F, x1, yb, x1 + F, yb, opt) + 'Z';
}
/** a radius token in px, as the engine resolved it (re-read on hx:theme) */
export const radius = (name = '--r-l'): number => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;
export const shape = { continuous, handle: (): number => handle(false), corner, slab, radius };
