// @vitest-environment jsdom
/* SectionHead: its tests at the kit's two unit levels (docs/kit/TERMS.md). Story: its props drawn as markup and states. Scene: its
   behaviour in jsdom, keys and clicks to events and ARIA. */
import { beforeEach, describe, expect, it } from 'vitest';
import { kit } from '../index';
import { contract } from './section-head';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
const EX: Parameters<typeof kit.html.sectionHead>[0] = { title: 'Today' };
beforeEach(() => { document.body.replaceChildren(); });

describe('story: SectionHead', () => {
  it('draws the component its contract names (data-kit="SectionHead")', () => {
    const el = put(kit.sectionHead(EX));
    expect(el.matches('[data-kit~="SectionHead"]') || !!el.querySelector('[data-kit~="SectionHead"]')).toBe(true);
    expect(contract.name).toBe('SectionHead');
  });
  it('a heading; a folding one holds a button that says whether it is open', () => {
    const h = put(kit.sectionHead({ title: 'Today', count: '4' }));
    expect(h.tagName).toBe('H3');
    expect(h.querySelector('.k7-shead__count')?.textContent).toBe('4');
    const f = put(kit.sectionHead({ title: 'Settled', disclosure: true, collapsed: true }));
    expect(f.querySelector('button')?.getAttribute('aria-expanded')).toBe('false');
  });
});
