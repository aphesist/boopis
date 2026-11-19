import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { concentric, CORNER_CSS } from './corners';

const ICON = 28;

describe('concentric corners (DESIGN-SYSTEM.md §8.2)', () => {
  it('the composer: 20 outer, 6 gap, a 28px send is a circle 6px from both edges', () => {
    const f = concentric({ outer: 20, pad: 6, floor: 8, size: ICON });
    expect(f).toMatchObject({ rIn: 14, radius: 14, inset: 6, ring: 2, gaveWay: false, loose: false });
    expect(f.inset + f.radius).toBe(f.outer);   /* one centre for both curves */
  });

  it('the table of §8.2, default corners', () => {
    expect(concentric({ outer: 20, pad: 4, floor: 8 }).rIn).toBe(16);    /* a menu item in a menu */
    expect(concentric({ outer: 20, pad: 6, floor: 8 }).rIn).toBe(14);    /* a button in a toast */
    expect(concentric({ outer: 12, pad: 3, floor: 8 }).rIn).toBe(9);     /* the segmented thumb */
    expect(concentric({ outer: 12, pad: 4, floor: 8 }).rIn).toBe(8);     /* a key in a tooltip */
    expect(concentric({ outer: 12, pad: 2, floor: 8 }).rIn).toBe(10);    /* a swatch in its well */
    expect(concentric({ outer: 30, pad: 12, floor: 8 }).rIn).toBe(18);   /* the close button in a dialog */
    expect(concentric({ outer: 30, pad: 6, floor: 8 }).rIn).toBe(24);    /* a row at the bottom of the palette */
  });

  it('under the floor the padding gives way, not the radius', () => {
    /* a well in a card: 20 − 16 would be 4, under the floor of 8, so the gap becomes 12 */
    const well = concentric({ outer: 20, pad: 16, floor: 8 });
    expect(well).toMatchObject({ rIn: 8, radius: 8, inset: 12, gaveWay: true, loose: false });
    /* a corner control in a 12px container asking for 6: 8 inside, 4 from the edges */
    const small = concentric({ outer: 12, pad: 6, floor: 8, size: ICON });
    expect(small).toMatchObject({ rIn: 8, radius: 8, inset: 4, gaveWay: true });
    expect(small.inset + small.radius).toBe(12);
    /* the ring tightens so it stays inside the container's line */
    expect(small.ring).toBe(1);
  });

  it('the inner radius is never larger than the outer, even with a floor above it', () => {
    const f = concentric({ outer: 6, pad: 3, floor: 8, size: ICON });
    expect(f.rIn).toBe(6);
    expect(f.inset).toBe(0);
    expect(f.ring).toBe(-2);   /* flush in the corner: the ring goes inside */
  });

  it('a control too small to be as round as rIn moves in so the curves still share a centre', () => {
    /* round corners: 26 outer, 6 gap: rIn 20, but a 28px control is at most a 14 circle */
    const f = concentric({ outer: 26, pad: 6, floor: 12, size: ICON });
    expect(f).toMatchObject({ rIn: 20, radius: 14, inset: 12, gaveWay: false });
    /* compact density: a 24px control in the default composer */
    expect(concentric({ outer: 20, pad: 6, floor: 8, size: 24 })).toMatchObject({ radius: 12, inset: 8 });
    /* comfortable density: a 32px control keeps rIn, drawn as a squircle, at the pad */
    expect(concentric({ outer: 20, pad: 6, floor: 8, size: 32 })).toMatchObject({ radius: 14, inset: 6 });
  });

  it('a round piece inside a pill stays a pill, at the pad on every side', () => {
    /* the dock session's composer: a 40px pill, the 28px actions 6px in */
    const f = concentric({ outer: 999, pad: 6, floor: 8, size: ICON, height: 40 });
    expect(f).toMatchObject({ outer: 20, rIn: 14, radius: 14, inset: 6 });
    /* the switch thumb: 3px in a pill */
    expect(concentric({ outer: 999, pad: 3, floor: 8, size: 14, height: 20 })).toMatchObject({ radius: 7, inset: 3 });
  });

  it('a gap as large as the outer radius is loose (the inner piece keeps its own step)', () => {
    expect(concentric({ outer: 12, pad: 12, floor: 8 }).loose).toBe(true);
    expect(concentric({ outer: 20, pad: 12, floor: 8 }).loose).toBe(false);
  });

  it('components.css declares exactly these formulas, once', () => {
    const css = readFileSync(join(__dirname, 'components.css'), 'utf8').replace(/\s+/g, ' ');
    expect(css).toContain('--r-in: ' + CORNER_CSS.rIn + ';');
    expect(css).toContain('--r-corner: ' + CORNER_CSS.radius + ';');
    expect(css).toContain('--corner-inset: ' + CORNER_CSS.inset + ';');
    expect(css).toContain('--corner-ring: ' + CORNER_CSS.ring + ';');
    /* nobody re-derives --r-in by hand in the library */
    expect(css.match(/--r-in:/g)?.length).toBe(1);
  });
});
