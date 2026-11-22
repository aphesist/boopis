/* The edge fade's flags (scroll-edges.ts, R-scroll-9): what lies beyond each edge of a scroller, from its scroll position. jsdom has
   no layout, so each scroller's geometry is given by hand. The CSS that reads the flags is checked by the lab, in a browser. */
import { describe, expect, it } from 'vitest';
import { edgesOf, update } from './scroll-edges';

type Geo = Partial<Record<'scrollTop' | 'scrollHeight' | 'clientHeight' | 'scrollLeft' | 'scrollWidth' | 'clientWidth', number>>;
function scroller(cls: string, g: Geo): HTMLElement {
  const el = document.createElement('div');
  el.className = cls;
  const all: Required<Geo> = { scrollTop: 0, scrollHeight: 100, clientHeight: 100, scrollLeft: 0, scrollWidth: 100, clientWidth: 100, ...g };
  for (const [k, v] of Object.entries(all)) Object.defineProperty(el, k, { configurable: true, value: v });
  return el;
}
const flags = (el: Element): string[] => ['top', 'bottom', 'left', 'right'].filter((k) => el.hasAttribute('data-more-' + k));

describe('the edge fade of a scroll area', () => {
  it('a vertical scroller at its start has more below only', () => {
    expect(edgesOf(scroller('ui-scroll', { scrollHeight: 500, clientHeight: 200 }))).toEqual({ top: false, bottom: true, left: false, right: false });
  });
  it('in the middle it has more on both ends, at its end more above only', () => {
    expect(edgesOf(scroller('ui-scroll', { scrollTop: 150, scrollHeight: 500, clientHeight: 200 }))).toMatchObject({ top: true, bottom: true });
    expect(edgesOf(scroller('ui-scroll', { scrollTop: 300, scrollHeight: 500, clientHeight: 200 }))).toMatchObject({ top: true, bottom: false });
  });
  it('a fractional position at an end is still the end', () => {
    expect(edgesOf(scroller('ui-scroll', { scrollTop: 299.5, scrollHeight: 500, clientHeight: 200 }))).toMatchObject({ bottom: false });
    expect(edgesOf(scroller('ui-scroll', { scrollTop: 0.6, scrollHeight: 500, clientHeight: 200 }))).toMatchObject({ top: false });
  });
  it('content that fits has no fade at all', () => {
    expect(flags((() => { const el = scroller('ui-scroll', { scrollHeight: 120, clientHeight: 120 }); update(el); return el; })())).toEqual([]);
  });
  it('a sideways strip reads its left and right, never its top and bottom', () => {
    const el = scroller('ui-scroll ui-scroll--x', { scrollLeft: 40, scrollWidth: 600, clientWidth: 300, scrollHeight: 900, clientHeight: 40 });
    expect(edgesOf(el)).toEqual({ top: false, bottom: false, left: true, right: true });
  });
  it('a block that scrolls both ways reads both axes', () => {
    const el = scroller('ui-scroll ui-scroll--both', { scrollHeight: 400, clientHeight: 200, scrollWidth: 400, clientWidth: 200, scrollLeft: 200 });
    expect(edgesOf(el)).toEqual({ top: false, bottom: true, left: true, right: false });
  });
  it('update writes the flags, and clears the ones that no longer hold', () => {
    const el = scroller('ui-scroll', { scrollTop: 150, scrollHeight: 500, clientHeight: 200 });
    update(el);
    expect(flags(el)).toEqual(['top', 'bottom']);
    Object.defineProperty(el, 'scrollTop', { configurable: true, value: 0 });
    update(el);
    expect(flags(el)).toEqual(['bottom']);
  });
});
