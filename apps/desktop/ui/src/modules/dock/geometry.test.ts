// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createMockProvider } from '../../data/mock-provider';
import { setProvider } from '../../data';
import { S } from './ctx';
import type { DockBot } from './ctx';
import { dockRoom, rowFit, rowMagRoom, rowWidth, slabCorner, slabWidthFor } from './geometry';
import { MAG, MAG_ADD, SIG } from './ctx';
import { V } from './views';

/* Boopis owner, Linux: with no bot on the dock the slab was a tall black tombstone around the "+", the foot's controls
   spilling out of its sides. The row is 60px wide with no bots, the foot about 130px, and the corner radius (30) is
   half of 60: the two corners met at the top. */
const ROW_EMPTY = 60, FOOT = 130, H = 76, R_TOP = 30;

describe('the slab is never narrower than its foot', () => {
  it('an empty row (a lone "+") takes the foot\'s width in the normal and expanded dock', () => {
    expect(slabWidthFor('normal', ROW_EMPTY, FOOT)).toBe(FOOT);
    expect(slabWidthFor('expanded', ROW_EMPTY, FOOT)).toBe(FOOT);
  });
  it('a row wider than the foot sets the width, as before', () => {
    expect(slabWidthFor('normal', 654, FOOT)).toBe(654);
  });
  it('the minimised pill and off have no foot, and the pill stays as narrow as its content', () => {
    expect(slabWidthFor('minimal', 96, FOOT)).toBe(96);
    expect(slabWidthFor('off', 96, FOOT)).toBe(96);
  });
});

describe('the top corners of the slab', () => {
  it('on the old 60px slab the corner is half the width: the top is a semicircle, a tombstone', () => {
    const { R } = slabCorner(ROW_EMPTY, H, R_TOP, R_TOP);
    expect(R * 2).toBe(ROW_EMPTY);
  });
  it('on the empty dock\'s slab the corner keeps its full radius and leaves a flat top', () => {
    const w = slabWidthFor('normal', ROW_EMPTY, FOOT);
    const { R, Fw } = slabCorner(w, H, R_TOP, R_TOP);
    expect(R).toBe(R_TOP);
    expect(w - 2 * R).toBeGreaterThan(0);
    expect(Fw).toBe(R_TOP);
  });
  it('a slab shorter than twice its radius still caps the corner at half the height', () => {
    expect(slabCorner(300, 28, R_TOP, R_TOP)).toEqual({ R: 14, Fw: 14 });
  });
});

describe('the bots row with no bots', () => {
  it('is the "+" and nothing else', () => {
    setProvider(createMockProvider({ simulate: false, fixtures: ['none'] }));
    S.bots = [] as DockBot[]; S.rowIdx = 0;
    const html = (V['bots:norm'] as () => string)();
    expect(html).toContain('data-act="new-bot"');
    expect(html).not.toContain('dk-bot"');
  });
});

/* Boopis owner's lab, 120 bots at 1440: the row ran 8px past the window and the slab's right corner off it. The row now fits
   its room with its padding and the most magnification widens it, at every width. */
describe('the bot row in its room', () => {
  const room = (w: number, pad = 16) => ({ room: w, floor: 24, ctl: 28, pad, mag: MAG, magCtl: MAG_ADD, sig: SIG });
  it('keeps 40px orbs at a 54px pitch while every bot fits', () => {
    expect(rowFit(11, room(696))).toEqual({ orb: 40, gap: 14, shown: 11, more: false });
  });
  it('shrinks the orbs before it leaves any bot out, never below the floor', () => {
    const f = rowFit(17, room(696));
    expect(f.more).toBe(false);
    expect(f.orb).toBeLessThan(40);
    expect(f.orb).toBeGreaterThanOrEqual(24);
  });
  for (const w of [256, 298, 640, 696, 1092]) {
    it(`with 120 bots in ${w}px it shows what fits, then "All bots", magnified included`, () => {
      const r = room(w, w < 300 ? 10 : 16), f = rowFit(120, r);
      expect(f.more).toBe(true);
      expect(f.orb).toBe(24);
      expect(rowWidth(f.orb, f.shown, true, r) + rowMagRoom(f.orb, f.shown, r)).toBeLessThanOrEqual(w);
      expect(rowWidth(f.orb, f.shown + 1, true, r) + rowMagRoom(f.orb, f.shown + 1, r)).toBeGreaterThan(w);
    });
  }
  it('the magnification room is at least what the orb under the pointer and the "+" add', () => {
    expect(rowMagRoom(24, 1, room(600))).toBeGreaterThanOrEqual(Math.ceil((MAG - 1) * 24 + (MAG_ADD - 1) * 28));
  });
});

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
