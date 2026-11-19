/* shape: the corner path for surfaces drawn as a path (the dock's slab). It is the same continuous corner every other
   surface takes from `squircle` (squircle-path.ts); the old name stays because the dock engine calls it. */
import { cornerTo, slabPath } from './squircle-path';
import { on } from '../core/bus';
import type { CornerOpt } from './squircle-path';

export type { CornerOpt };
/** a radius token in px, as the engine resolved it (re-read on hx:theme) */
export const radius = (name = '--r-l'): number => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;
/** the smoothing token (0.6) as the engine resolved it. The dock draws its slab here on every frame of a morph, so this
    must not read the computed style every time (that forces a style recalculation of the whole document, inside the
    frame): it is read once and again after a theme change. */
let smoothing: number | null = null;
const smoothingNow = (): number => {
  if (smoothing === null) { const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--corner-smoothing')); smoothing = v >= 0 && v <= 1 ? v : 0.6; }
  return smoothing;
};
/* the token changes with the theme: a preset, the corner setting, the density (the same triggers the squircle engine watches) */
on('hx:theme', () => { smoothing = null; });
if (typeof MutationObserver === 'function') new MutationObserver(() => { smoothing = null; }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-hx-corners', 'data-hx-preset', 'data-hx-density', 'style'] });
export const corner = (ax: number, ay: number, cx: number, cy: number, bx: number, by: number, o?: CornerOpt): string => cornerTo(ax, ay, cx, cy, bx, by, { smoothing: smoothingNow(), ...o });
export const slab = (w: number, h: number, R: number, F: number, o?: CornerOpt): string => slabPath(w, h, R, F, { smoothing: smoothingNow(), ...o });
export const shape = { continuous: (): boolean => true, corner, slab, radius };
