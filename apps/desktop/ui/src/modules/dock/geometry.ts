/* The dock's room, pure (no DOM), so it can be tested. */

/** The room the dock may take around its middle, in px: twice the nearer distance from the middle to the ground's edges (the
    views' area between the sidebar and the details panel), less the slab's flares and a 2px margin on each side. The middle is
    the column's centre line, or the window's when the dock is kept centred in the window (the owner's setting): then, with a
    sidebar open, the room is the narrower one between the bars around the window's middle, so the dock never covers them. */
export function dockRoom(o: { centred: boolean; viewportW: number; centerX: number; viewLeft: number; viewRight: number; flare: number }): number {
  const cx = o.centred ? o.viewportW / 2 : o.centerX;
  return Math.floor(2 * (Math.min(cx - o.viewLeft, o.viewRight - cx) - o.flare - 2));
}
