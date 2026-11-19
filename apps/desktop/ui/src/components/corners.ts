/* corners: the nesting arithmetic of DESIGN-SYSTEM.md §8.2 (owner decision: nested corners fit their container; R-corner-3, R-corner-4, R-corner-9), in
   one place. components.css declares the same formulas once for every container (`.ui-nest` and the library's own),
   so a screen never sets a radius or an inset in a corner by hand; this module is the same maths for code that needs
   the numbers (tests, the UI lab, a canvas) and the reference the CSS is checked against.

   A container declares its radius (--r-outer), the gap it wants around what sits in its corners (--pad) and, when
   that is not an icon-button square, the size of what sits there (--corner-size, default --ctl-s). Derived:
     rIn     = min(outer, max(floor, outer − pad))     the inner radius; never under the floor, never over the outer
     radius  = min(rIn, size / 2)                      what a corner control can be (a 28px square is at most a circle)
     inset   = max(0, outer − radius)                  where it sits, so both curves share a centre: the pad when the
                                                        formula holds, less where the padding gives way to the floor,
                                                        more where the control cannot be as round as rIn
     ring    = clamp(−2, inset − 3, 2)                 the focus ring's offset: a 2px ring and the container's 1px line
                                                        stay inside the container
   A pill container passes its height (its radius is half of it), so a round piece inside it stays a pill and sits
   at the pad on every side. The drawn corner (squircle.ts) reads the resulting radii, so drawn corners nest too; a
   corner as round as half its element stays a native circle (§8.1). */

export interface Nest {
  /** the container's radius (--r-outer) */
  outer: number;
  /** the gap the container asks for around what sits in its corners (--pad) */
  pad: number;
  /** the smallest inner radius (--r-floor) */
  floor: number;
  /** the size (block size) of what sits in the corner (--corner-size); omit for a surface with no size limit */
  size?: number | undefined;
  /** the container's height, for a pill (an outer radius of 999 means half the height) */
  height?: number | undefined;
}
export interface Fit {
  /** the container's real radius (a pill's is half its height) */
  outer: number;
  /** --r-in: the radius a nested surface takes */
  rIn: number;
  /** --r-corner: the radius a corner control takes (rIn, or a circle when the control is too small for rIn) */
  radius: number;
  /** --corner-inset: the control's distance from both edges of the corner */
  inset: number;
  /** --corner-ring: the focus ring's outline-offset in the corner */
  ring: number;
  /** the padding gave way: the formula went under the floor, so the inset is less than the pad */
  gaveWay: boolean;
  /** the gap is as large as the outer radius or larger: the inner piece keeps its own step (§8.2 "Tight or loose") */
  loose: boolean;
}

const RING = 2, LINE = 1;

export function concentric(n: Nest): Fit {
  const outer = Math.max(0, n.height != null ? Math.min(n.outer, n.height / 2) : n.outer);
  const pad = Math.max(0, n.pad), floor = Math.max(0, n.floor);
  const rIn = Math.min(outer, Math.max(floor, outer - pad));
  const radius = n.size != null ? Math.min(rIn, n.size / 2) : rIn;
  const inset = Math.max(0, outer - radius);
  const ring = Math.max(-RING, Math.min(RING, inset - RING - LINE));
  return { outer, rIn, radius, inset, ring, gaveWay: inset < pad, loose: pad >= outer && outer > 0 };
}

/** the CSS the container rule in components.css declares, as text (the UI lab and the tests compare against it) */
export const CORNER_CSS = {
  rIn: 'min(var(--r-outer), max(var(--r-floor), calc(var(--r-outer) - var(--pad))))',
  radius: 'min(var(--r-in), calc(var(--corner-size) / 2))',
  inset: 'max(0px, calc(var(--r-outer) - var(--r-corner)))',
  ring: 'clamp(-2px, calc(var(--corner-inset) - 3px), 2px)'
} as const;
