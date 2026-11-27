// @vitest-environment jsdom
/* StatusLine: its tests at the kit's two unit levels (docs/kit/TERMS.md). Story: its props drawn as markup and states. Scene: its
   behaviour in jsdom, keys and clicks to events and ARIA. */
import { beforeEach, describe, expect, it } from 'vitest';
import { kit } from '../index';
import { contract } from './status-line';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
const EX: Parameters<typeof kit.html.statusLine>[0] = { phrase: 'Reading the tests' };
beforeEach(() => { document.body.replaceChildren(); });

describe('story: StatusLine', () => {
  it('draws the component its contract names (data-kit="StatusLine")', () => {
    const el = put(kit.statusLine(EX));
    expect(el.matches('[data-kit~="StatusLine"]') || !!el.querySelector('[data-kit~="StatusLine"]')).toBe(true);
    expect(contract.name).toBe('StatusLine');
  });
  it('a polite status that shimmers while it works; inside the pill it has no live region', () => {
    const s = put(kit.statusLine({ kind: 'system', phrase: 'Reading the tests' }));
    expect([s.getAttribute('role'), s.getAttribute('aria-live'), s.hasAttribute('data-working')]).toEqual(['status', 'polite', true]);
    expect(s.querySelector('.k7-shimmer')?.textContent).toBe('Reading the tests');
    const p = put(kit.statusLine({ kind: 'system', phrase: 'Done', working: false, inPill: true }));
    expect([p.hasAttribute('role'), p.hasAttribute('data-working')]).toEqual([false, false]);
  });
});
