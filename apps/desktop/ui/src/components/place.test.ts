import { afterEach, describe, expect, it } from 'vitest';
import { avoidRects, parsePos, placeRect } from './place';
import type { Box } from './place';

const view = { w: 1440, h: 900 };
const box = (left: number, top: number, w: number, h: number): Box => ({ left, top, right: left + w, bottom: top + h });
const inter = (a: Box, b: Box): boolean => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/* the session composer at 1440x900: a 720px box, its text above a 40px bar, attach and send in its bottom corners */
const comp = box(360, 700, 720, 101);
const input = box(360, 700, 720, 61);
const attach = box(366, 767, 28, 28);
const send = box(1046, 767, 28, 28);

describe('placeRect (R-float-1, R-tip-2)', () => {
  it('puts a tip outside the anchor with the gap, centred by default', () => {
    const p = placeRect({ anchor: box(500, 400, 28, 28), w: 100, h: 26, view, side: 'bottom' });
    expect(p).toEqual({ x: 464, y: 436, side: 'bottom', align: 'center' });
    /* R-float-1: the same 8 to the side (the rail's tooltip was 10) */
    const q = placeRect({ anchor: box(500, 400, 28, 28), w: 100, h: 26, view, side: 'right' });
    expect(q.x).toBe(536); expect(q.y).toBe(401);
  });

  it('aligns to the control: start lines up the left edges, end the right edges', () => {
    const s = placeRect({ anchor: attach, w: 106, h: 26, view, side: 'top', align: 'start' });
    expect(s.x).toBe(attach.left);
    const e = placeRect({ anchor: send, w: 90, h: 26, view, side: 'top', align: 'end' });
    expect(e.x + 90).toBe(send.right);
  });

  it('R-tip-2: a composer corner control\'s tip sits above, aligned to it, never over the input text', () => {
    for (const [a, align] of [[attach, 'start'], [send, 'end']] as const) {
      const p = placeRect({ anchor: a, w: 106, h: 26, view, side: 'top', align, avoid: [input] });
      const r = box(p.x, p.y, 106, 26);
      expect(p.side).toBe('top');
      expect(inter(r, input)).toBe(false);
      expect(r.bottom).toBe(input.top - 8);   /* past the text, with the gap */
      expect(r.left >= comp.left && r.right <= comp.right).toBe(true);   /* not hanging past the composer's corner */
    }
  });

  it('flips to the other side when the preferred one does not fit', () => {
    const p = placeRect({ anchor: box(500, 10, 28, 28), w: 100, h: 26, view, side: 'top' });
    expect(p.side).toBe('bottom'); expect(p.y).toBe(46);
    const q = placeRect({ anchor: box(1400, 400, 28, 28), w: 100, h: 26, view, side: 'right' });
    expect(q.side).toBe('left'); expect(q.x).toBe(1292);
    /* the avoided text pushes it out of the window above: it goes below the anchor instead */
    const hi = placeRect({ anchor: box(366, 60, 28, 28), w: 100, h: 26, view, side: 'top', avoid: [box(360, 20, 720, 40)] });
    expect(hi.side).toBe('bottom');
  });

  it('shifts along the edge to stay in the window', () => {
    const p = placeRect({ anchor: box(2, 400, 28, 28), w: 120, h: 26, view, side: 'bottom' });
    expect(p.x).toBe(8);
    const q = placeRect({ anchor: box(1420, 400, 16, 16), w: 120, h: 26, view, side: 'top', align: 'start' });
    expect(q.x).toBe(1440 - 120 - 8);
  });

  it('keeps a menu\'s overhang at the start and none at the end', () => {
    expect(placeRect({ anchor: box(500, 400, 80, 28), w: 240, h: 200, view, side: 'bottom', align: 'start', overhang: 8 }).x).toBe(492);
    expect(placeRect({ anchor: box(500, 400, 80, 28), w: 240, h: 200, view, side: 'bottom', align: 'end' }).x).toBe(340);
  });

  it('does not avoid a rect that holds the anchor (a menu on a word in the text)', () => {
    const word = box(400, 710, 60, 22);
    const p = placeRect({ anchor: word, w: 240, h: 120, view, side: 'top', align: 'start', avoid: [input] });
    expect(p.y + 120).toBe(word.top - 8);
  });

  it('picks the side with more room when neither fits, inside the window', () => {
    const p = placeRect({ anchor: box(500, 300, 28, 28), w: 100, h: 600, view: { w: 1440, h: 800 }, side: 'top' });
    expect(p.side).toBe('bottom');
    expect(p.y).toBeGreaterThanOrEqual(8);
  });
});

describe('parsePos', () => {
  it('reads a side and an alignment', () => {
    expect(parsePos('top-start')).toEqual({ side: 'top', align: 'start' });
    expect(parsePos('right')).toEqual({ side: 'right', align: 'center' });
    expect(parsePos('sideways')).toBeNull();
    expect(parsePos(null)).toBeNull();
  });
});

describe('avoidRects', () => {
  afterEach(() => { document.body.replaceChildren(); });
  it('finds what the nearest container names, and nothing without one', () => {
    document.body.innerHTML = '<div data-overlay-avoid=".t"><div class="t"></div><button id="b"></button></div><button id="c"></button>';
    const t = document.querySelector('.t') as HTMLElement;
    t.getBoundingClientRect = (): DOMRect => ({ left: 1, top: 2, right: 11, bottom: 12, width: 10, height: 10, x: 1, y: 2, toJSON: () => ({}) });
    expect(avoidRects(document.getElementById('b') as Element)).toHaveLength(1);
    expect(avoidRects(document.getElementById('c') as Element)).toHaveLength(0);
  });
});
