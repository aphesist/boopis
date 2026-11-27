// @vitest-environment jsdom
/* SelectorItem: its tests at the kit's two unit levels (docs/kit/TERMS.md). Story: its props drawn as markup and states. Scene: its
   behaviour in jsdom, keys and clicks to events and ARIA. */
import { beforeEach, describe, expect, it } from 'vitest';
import { kit } from '../index';
import { contract } from './selector-item';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
const EX: Parameters<typeof kit.html.selectorItem>[0] = { value: 'Opus', label: 'Model' };
beforeEach(() => { document.body.replaceChildren(); });

describe('story: SelectorItem', () => {
  it('draws the component its contract names (data-kit="SelectorItem")', () => {
    const el = put(kit.selectorItem(EX));
    expect(el.matches('[data-kit~="SelectorItem"]') || !!el.querySelector('[data-kit~="SelectorItem"]')).toBe(true);
    expect(contract.name).toBe('SelectorItem');
  });
  it('opens a menu, says what it sets and its value, and says when its menu is open', () => {
    const s = put(kit.selectorItem({ value: 'Opus', label: 'Model', open: true }));
    expect(s.getAttribute('aria-haspopup')).toBe('menu');
    expect(s.getAttribute('aria-label')).toBe('Model: Opus');
    expect(s.getAttribute('aria-expanded')).toBe('true');
  });
  it('draws its ticks, and a colour as a swatch dot', () => {
    const s = put(kit.selectorItem({ value: 'Careful', ticks: { of: 4, on: 2 } }));
    expect(s.querySelectorAll('.k7-ticks i[data-on]').length).toBe(2);
    const c = put(kit.selectorItem({ value: 'Iris', swatch: '#7c6cf0' }));
    expect(c.querySelector('.k7-swatch-dot')).not.toBeNull();
  });
});
