import { describe, expect, it } from 'vitest';
import { dockRoom } from './geometry';

/* "Keep the dock centred in the window" (owner, 22 November 2026): the dock's middle is the window's, whatever the bars do, and
   its views fit the room between the bars around that middle, so with a sidebar open the dock never covers it */
describe('the room around the dock\'s middle', () => {
  const FLARE = 30;
  /* 1200px wide, the sidebar open (288) or a rail (56), the details panel closed: the column's centre line moves, the window's does not */
  const open = { viewportW: 1200, viewLeft: 288, viewRight: 1200, centerX: (288 + 1200) / 2, flare: FLARE };
  const rail = { viewportW: 1200, viewLeft: 56, viewRight: 1200, centerX: (56 + 1200) / 2, flare: FLARE };
  it('on the column: the room around its centre line, which moves with the sidebar', () => {
    expect(dockRoom({ ...open, centred: false })).toBe(2 * (456 - FLARE - 2));
    expect(dockRoom({ ...rail, centred: false })).toBe(2 * (572 - FLARE - 2));
  });
  it('centred in the window: the room between the bars around the window\'s middle, never past the open sidebar', () => {
    const room = dockRoom({ ...open, centred: true });
    expect(room).toBe(2 * (600 - 288 - FLARE - 2));
    expect(600 - room / 2 - FLARE).toBeGreaterThanOrEqual(288);   /* the slab, flares included, ends before the sidebar */
    expect(dockRoom({ ...rail, centred: true })).toBe(2 * (600 - 56 - FLARE - 2));
  });
  it('centred in the window with the details panel open: the nearer bar sets the room', () => {
    expect(dockRoom({ viewportW: 1440, viewLeft: 288, viewRight: 1440 - 340, centerX: (288 + 1100) / 2, flare: FLARE, centred: true })).toBe(2 * (1100 - 720 - FLARE - 2));   /* the panel, 380 away, is nearer than the sidebar, 432 */
  });
});
