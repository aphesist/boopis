// @vitest-environment jsdom
/* FindBar: its tests at the kit's two unit levels (docs/kit/TERMS.md). Story: its props drawn as markup and states. Scene: its
   behaviour in jsdom, keys and clicks to events and ARIA.
  Cases moved from kit-6e.test.ts keep their words. */
import { beforeEach, describe, expect, it } from 'vitest';
import { kit } from '../index';
import { contract } from './find-bar';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
const EX: Parameters<typeof kit.html.findBar>[0] = { id: 'find', count: '3 of 12' };
beforeEach(() => { document.body.replaceChildren(); });

describe('story: FindBar', () => {
  it('draws the component its contract names (data-kit="FindBar")', () => {
    const el = put(kit.findBar(EX));
    expect(el.matches('[data-kit~="FindBar"]') || !!el.querySelector('[data-kit~="FindBar"]')).toBe(true);
    expect(contract.name).toBe('FindBar');
  });
  it('a search landmark whose count is a polite status', () => {
    const f = put(kit.findBar(EX));
    expect(f.getAttribute('role')).toBe('search');
    const c = f.querySelector('#find-count') as HTMLElement;
    expect([c.getAttribute('role'), c.textContent, c.hasAttribute('data-none')]).toEqual(['status', '3 of 12', false]);
  });
  it('a search with its count, previous, next and close; "No matches" is quiet', () => {
    const b = put(kit.findBar({ id: 'f', count: '3 of 12' }));
    expect(b.getAttribute('role')).toBe('search');
    expect(b.querySelector('#f')?.getAttribute('aria-describedby')).toBe('f-count');
    expect([...b.querySelectorAll<HTMLElement>('[data-find]')].map((x) => x.dataset['find'])).toEqual(['prev', 'next', 'close']);
    expect(b.querySelector('.k7-find__count')?.textContent).toBe('3 of 12');
    expect(put(kit.findBar({ id: 'f', count: 'No matches' })).querySelector('.k7-find__count')?.hasAttribute('data-none')).toBe(true);
  });
});
