// @vitest-environment jsdom
/* Rail: its tests at the kit's two unit levels (docs/kit/TERMS.md). Story: its props drawn as markup and states. Scene: its
   behaviour in jsdom, keys and clicks to events and ARIA.
  Cases moved from thread.test.ts keep their words. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kit } from '../index';
import { contract } from './rail';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
const tabs = { value: 'bots', items: [{ value: 'session', label: 'Sessions', icon: 'session' }, { value: 'bots', label: 'Bots', icon: 'bots' }] };
const EX: Parameters<typeof kit.html.rail>[0] = { bots: [] };
beforeEach(() => { document.body.replaceChildren(); });

describe('story: Rail', () => {
  it('draws the component its contract names (data-kit="Rail")', () => {
    const el = put(kit.rail(EX));
    expect(el.matches('[data-kit~="Rail"]') || !!el.querySelector('[data-kit~="Rail"]')).toBe(true);
    expect(contract.name).toBe('Rail');
  });
  it('a nav of named tiles, the open one current; a bot that needs you says so in its name', () => {
    const r = put(kit.rail({ bots: [{ id: 'kai', name: 'kai', current: true }, { id: 'nina', name: 'nina', needs: true }] }));
    expect([r.tagName, r.getAttribute('aria-label')]).toEqual(['NAV', 'Bots']);
    const tiles = [...r.querySelectorAll<HTMLElement>('.k7-tile')];
    expect(tiles.map((t) => t.getAttribute('aria-label'))).toEqual(['kai', 'nina, needs you']);
    expect(tiles[0]?.getAttribute('aria-current')).toBe('page');
  });
  it('a room\'s cluster: its members on the circle around the box\'s middle; a room with one member left is that one orb, its box the orb\'s', () => {
    const tri = (n: number): HTMLElement => put(kit.rail({ bots: [], groups: [{ name: 'crew', members: ['atlas', 'nina', 'kai'].slice(0, n).map((name) => ({ name })) }] })).querySelector('.k7-rail__tri') as HTMLElement;
    const at = (t: HTMLElement): { x: number; y: number }[] => [...t.querySelectorAll<HTMLElement>(':scope > span')].map((s) => ({ x: parseFloat(s.style.getPropertyValue('--x')), y: parseFloat(s.style.getPropertyValue('--y')) }));
    const one = tri(1);
    expect(one.hasAttribute('data-one')).toBe(true);
    expect(at(one)).toEqual([{ x: 0, y: 0 }]);
    /* the standard rail's cluster orb is 15 (0.42 of 36), its box 37.5: an orb on the middle starts at 18.75 - 7.5 */
    const three = tri(3), mid = 15 * 1.25 - 15 / 2, pts = at(three);
    expect(three.hasAttribute('data-one')).toBe(false);
    expect(pts).toHaveLength(3);
    expect(pts[0]!.y).toBeCloseTo(mid - 15 * 0.62, 5);   /* the first at the top */
    expect(pts.reduce((a, p) => a + p.x, 0) / 3).toBeCloseTo(mid, 5);
    expect(pts.reduce((a, p) => a + p.y, 0) / 3).toBeCloseTo(mid, 5);
  });
});

describe('story: Rail, the upright switch', () => {
  it('the rail carries the Segmented stood on its end: two named glyph items, the open tab chosen', () => {
    const rail = put(kit.rail({ bots: [], tabs, newLabel: 'New session' }));
    const seg = rail.querySelector('[data-rail-tabs]') as HTMLElement;
    expect(seg.dataset['kit']).toBe('Segmented');
    expect(seg.hasAttribute('data-upright')).toBe(true);
    expect(seg.getAttribute('aria-orientation')).toBe('vertical');
    expect([...seg.querySelectorAll('[role="tab"]')].map((t) => t.getAttribute('aria-label') + ':' + t.getAttribute('aria-selected'))).toEqual(['Sessions:false', 'Bots:true']);
    expect(rail.querySelectorAll('.k7-tile').length).toBe(0);
    expect(rail.querySelector('.k7-rail__foot button')?.getAttribute('aria-label')).toBe('New session');
  });
  it('a rail without the switch is as it was', () => { expect(put(kit.rail({ bots: [] })).querySelector('[data-rail-tabs]')).toBeNull(); });
});

describe('scene: Rail, the upright switch', () => {
  it('a press, or the arrows, choose a tab and say so', () => {
    const rail = put(kit.rail({ bots: [], tabs })), changed = vi.fn();
    rail.addEventListener('ui:change', (e) => { changed((e as CustomEvent<{ value: string }>).detail.value); });
    (rail.querySelector('[data-value="session"]') as HTMLElement).click();
    expect(changed).toHaveBeenCalledWith('session');
    const on = rail.querySelector('[aria-selected="true"]') as HTMLElement;
    on.focus();
    on.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(changed).toHaveBeenLastCalledWith('bots');
  });
});
