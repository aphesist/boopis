/* The slab's size rules, pure (no DOM), so they can be tested: which width the slab takes and how its top corners are cut. */
import type { DockMode } from '../../core/bus';

/** The slab's width at rest. The foot (Arrange, the page nub, Minimise) lives inside the slab in the normal and expanded
    dock, so there the slab is never narrower than its foot: with no bots the row is a lone "+" (60px with its padding),
    and a slab that narrow has its top corners meet and the foot spill out of its sides. The minimised pill and off have no
    foot, and the pill stays as narrow as its content. */
export function slabWidthFor(mode: DockMode, viewW: number, footW: number): number {
  return mode === 'normal' || mode === 'expanded' ? Math.max(viewW, footW) : viewW;
}

/** The top corner radius and the concave flare of a slab `w` by `h`: the radius is capped at half the height and half the
    width, and the flare at what the height leaves under the corner. */
export function slabCorner(w: number, h: number, rTop: number, flare: number): { R: number; Fw: number } {
  const R = Math.min(rTop, h / 2, w / 2);
  const F = Math.min(Math.max(Math.min(flare, h - R), 0), flare);
  return { R, Fw: F };
}

/** What the bot row's room has to hold, in px: `room` is the width the row may take (the column, and the window's room
    around the centre line less the slab's flares), `floor` the smallest orb (`--hit-min`), `ctl` the "+" button's width,
    `pad` the row's side padding, `mag` and `magCtl` how much an orb and the "+" grow under the pointer. */
export interface RowRoom { room: number; floor: number; ctl: number; pad: number; mag: number; magCtl: number; sig: number }
export interface RowFit { orb: number; gap: number; shown: number; more: boolean }
/** the row's gap, always a value the design system names: the dock's own 14px (R-space-2) while the orbs are near full size,
    then --sp-3 and --sp-2 as they shrink */
export const rowGap = (o: number): number => (o >= 36 ? 14 : o >= 28 ? 12 : 8);
/** the row's width: `k` orbs, then "All bots" when some are left out, then "+" (the flex gap between each) */
export const rowWidth = (o: number, k: number, more: boolean, r: Pick<RowRoom, 'ctl' | 'pad'>): number =>
  2 * r.pad + k * o + (more ? 2 : 1) * r.ctl + (k + (more ? 1 : 0)) * rowGap(o);
/** The most the row widens while the pointer magnifies it: the orb under the pointer grows by (mag - 1) of its width and
    its neighbours by a gaussian of their distance; summed over every orb on both sides (an upper bound: the pointer can
    sit on any of them), plus the "+" at its own scale. The slab grows by exactly this sum (engine.ts stepMag). */
export function rowMagRoom(o: number, k: number, r: Pick<RowRoom, 'ctl' | 'mag' | 'magCtl' | 'sig'>): number {
  const p = o + rowGap(o);
  let s = 1;
  for (let j = 1; j < k; j++) { const e = Math.exp(-Math.pow((j * p) / r.sig, 2)); if (e < 1e-4) break; s += 2 * e; }
  return Math.ceil((r.mag - 1) * o * s + (r.magCtl - 1) * r.ctl);
}
/** The bot row in its room, magnification and padding included, so the slab never runs past the window: 40px orbs at a
    54px pitch while every bot fits, then smaller orbs down to the floor (an orb is a pointer target, R-a11y-2), then as
    many orbs as fit, followed by "All bots" (the expanded roster holds every bot). At least one orb shows. */
export function rowFit(n: number, r: RowRoom): RowFit {
  const fits = (o: number, k: number, more: boolean): boolean => rowWidth(o, k, more, r) + rowMagRoom(o, k, r) <= r.room;
  for (let o = 40; o >= r.floor; o--) if (fits(o, n, false)) return { orb: o, gap: rowGap(o), shown: n, more: false };
  const o = Math.min(40, r.floor);
  if (n <= 1) return { orb: o, gap: rowGap(o), shown: n, more: false };
  let k = n - 1;
  while (k > 1 && !fits(o, k, true)) k--;
  return { orb: o, gap: rowGap(o), shown: Math.max(1, k), more: true };
}
