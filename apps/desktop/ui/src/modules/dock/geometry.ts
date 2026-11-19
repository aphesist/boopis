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
