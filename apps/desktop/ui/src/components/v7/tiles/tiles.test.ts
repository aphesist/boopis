// @vitest-environment jsdom
/* Tiles: its tests at the kit's two unit levels (docs/kit/TERMS.md). Story: its props drawn as markup and states. Scene: its behaviour in
   jsdom, presses to events and ARIA. */
import { beforeEach, describe, expect, it } from 'vitest';
import { kit } from '../index';
import { contract } from './tiles';
import type { TilesOpts } from './tiles';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
const G = (n = 0): TilesOpts => ({ label: 'Goals', head: 'Pick up to three.', tiles: ['a', 'b', 'c', 'd'].map((v, i) => ({ label: v.toUpperCase(), value: v, icon: 'code', chosen: i < n })), max: 3, action: { label: 'Next', on: n > 0 } });
beforeEach(() => { document.body.replaceChildren(); });

describe('story: Tiles', () => {
  it('draws the component its contract names (data-kit="Tiles")', () => {
    const el = put(kit.tiles(G()));
    expect(el.matches('[data-kit~="Tiles"]')).toBe(true);
    expect(contract.name).toBe('Tiles');
  });
  it('a goal is a toggle; the count and the action say how many are chosen', () => {
    const el = put(kit.tiles(G(1)));
    expect([...el.querySelectorAll('.k7-tiles__tile')].map((t) => t.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false', 'false']);
    expect(el.querySelector('.k7-tiles__note')?.textContent).toBe('1 of 3');
    expect(put(kit.tiles(G(0))).querySelector('[data-tiles-act]')?.getAttribute('aria-disabled')).toBe('true');
  });
  it('bots: each a bot over a chip of its job, and the foot\'s quiet line', () => {
    const el = put(kit.tiles({ variant: 'bots', label: 'Bots', tiles: [{ label: 'Reviews pull requests', value: 'kai', leadHTML: '<i data-orb></i>' }], action: { label: 'Got it' }, note: 'Yours get their own jobs next' }));
    expect(el.querySelector('[data-kit-part="TileBot"] [data-orb]')).toBeTruthy();
    expect(el.querySelector('.k7-tiles__note')?.textContent).toBe('Yours get their own jobs next');
  });
});

describe('scene: Tiles', () => {
  it('a press toggles a goal and says so; past the most it is refused', () => {
    const el = put(kit.tiles(G(2)));
    const seen: string[] = [];
    el.addEventListener('ui:change', (e) => { seen.push(String((e as CustomEvent<{ value: string }>).detail.value)); });
    el.querySelector<HTMLButtonElement>('[data-value="c"]')?.click();
    expect(el.querySelector('[data-value="c"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(el.querySelector('.k7-tiles__note')?.textContent).toBe('3 of 3');
    el.querySelector<HTMLButtonElement>('[data-value="d"]')?.click();
    expect(el.querySelector('[data-value="d"]')?.getAttribute('aria-pressed')).toBe('false');
    expect(seen).toEqual(['c']);
    el.querySelector<HTMLButtonElement>('[data-value="a"]')?.click();
    expect(el.querySelector('.k7-tiles__note')?.textContent).toBe('2 of 3');
  });
  it('a listener that cancels keeps the goal as it was', () => {
    const el = put(kit.tiles(G(0)));
    el.addEventListener('ui:change', (e) => { e.preventDefault(); });
    el.querySelector<HTMLButtonElement>('[data-value="a"]')?.click();
    expect(el.querySelector('[data-value="a"]')?.getAttribute('aria-pressed')).toBe('false');
    expect(el.querySelector('[data-tiles-act]')?.getAttribute('aria-disabled')).toBe('true');
  });
});
