// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createMockProvider } from '../../data/mock-provider';
import { setProvider } from '../../data';
import { S } from './ctx';
import type { DockBot } from './ctx';
import { slabCorner, slabWidthFor } from './geometry';
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
