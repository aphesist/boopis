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
