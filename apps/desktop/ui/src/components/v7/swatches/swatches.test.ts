// @vitest-environment jsdom
/* Swatches: its tests at the kit's two unit levels (docs/kit/TERMS.md). Story: its props drawn as markup and states. Scene: its
   behaviour in jsdom, keys and clicks to events and ARIA. */
import { beforeEach, describe, expect, it } from 'vitest';
import { kit } from '../index';
import { contract } from './swatches';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
const EX: Parameters<typeof kit.html.swatches>[0] = { label: 'Accent', items: [{ label: 'Iris', hex: '#7c6cf0' }, { label: 'Moss', hex: '#5f9e6e' }] };
beforeEach(() => { document.body.replaceChildren(); });

describe('story: Swatches', () => {
  it('draws the component its contract names (data-kit="Swatches")', () => {
    const el = put(kit.swatches(EX));
    expect(el.matches('[data-kit~="Swatches"]') || !!el.querySelector('[data-kit~="Swatches"]')).toBe(true);
    expect(contract.name).toBe('Swatches');
  });
  it('shows colours as a list, each named with its hex; choosing makes it a radio group with one tab stop', () => {
    const l = put(kit.swatches(EX));
    expect(l.getAttribute('role')).toBe('list');
    expect(l.querySelector('[role="listitem"]')?.getAttribute('aria-label')).toBe('Iris #7c6cf0');
    const r = put(kit.swatches({ ...EX, choose: true, value: '#5f9e6e' }));
    expect(r.getAttribute('role')).toBe('radiogroup');
    expect([...r.querySelectorAll<HTMLElement>('[role="radio"]')].map((x) => [x.getAttribute('aria-checked'), x.tabIndex])).toEqual([['false', -1], ['true', 0]]);
  });
});

describe('scene: Swatches', () => {
  it('chooses by a press and by the arrows, Home and End, with one tab stop, and says so with ui:change; a listener can keep it as it was', () => {
    const r = put(kit.swatches({ ...EX, items: [...EX.items, { label: 'Rose', hex: '#d0607a' }], choose: true, value: '#7c6cf0' }));
    const got: unknown[] = [];
    r.addEventListener('ui:change', (e) => { got.push((e as CustomEvent<{ value: string }>).detail.value); });
    const items = (): HTMLElement[] => [...r.querySelectorAll<HTMLElement>('[role="radio"]')];
    const on = (): string[] => items().filter((x) => x.getAttribute('aria-checked') === 'true').map((x) => x.dataset['value'] ?? '');
    items()[1]?.click();
    expect(on()).toEqual(['#5f9e6e']);
    items()[1]?.focus();
    items()[1]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(on()).toEqual(['#d0607a']);
    expect(document.activeElement).toBe(items()[2]);
    items()[2]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(on()).toEqual(['#7c6cf0']);
    expect(items().map((x) => x.tabIndex)).toEqual([0, -1, -1]);
    expect(got).toEqual(['#5f9e6e', '#d0607a', '#7c6cf0']);
    r.addEventListener('ui:change', (e) => { e.preventDefault(); });
    items()[2]?.click();
    expect(on()).toEqual(['#7c6cf0']);
  });
  it('a face stands in place of the colour (a bot\'s shape)', () => {
    const r = put(kit.swatches({ label: 'Shape', choose: true, value: 'star', items: [{ label: 'Star', hex: '#d0607a', value: 'star', face: '<b class="face"></b>' }] }));
    expect(r.querySelector('.k7-swatches__face > .face')).toBeTruthy();
    expect(r.querySelector('.k7-swatches__dot')).toBeNull();
  });
});
