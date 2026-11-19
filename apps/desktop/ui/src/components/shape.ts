/* shape: the corner path for surfaces drawn as a path (the dock's slab). It is the same continuous corner every other
   surface takes from `squircle` (squircle-path.ts); the old name stays because the dock engine calls it. */
import { cornerTo, slabPath } from './squircle-path';
import type { CornerOpt } from './squircle-path';

export type { CornerOpt };
/** a radius token in px, as the engine resolved it (re-read on hx:theme) */
export const radius = (name = '--r-l'): number => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;
/** the smoothing token (0.6) as the engine resolved it */
const smoothingNow = (): number => { const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--corner-smoothing')); return v >= 0 && v <= 1 ? v : 0.6; };
export const corner = (ax: number, ay: number, cx: number, cy: number, bx: number, by: number, o?: CornerOpt): string => cornerTo(ax, ay, cx, cy, bx, by, { smoothing: smoothingNow(), ...o });
export const slab = (w: number, h: number, R: number, F: number, o?: CornerOpt): string => slabPath(w, h, R, F, { smoothing: smoothingNow(), ...o });
export const shape = { continuous: (): boolean => true, corner, slab, radius };
