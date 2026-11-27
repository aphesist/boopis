// @vitest-environment jsdom
/* Page: its tests at the kit's two unit levels (docs/kit/TERMS.md). Story: its props drawn as markup and states. Scene: its
   behaviour in jsdom, keys and clicks to events and ARIA. */
import { beforeEach, describe, expect, it } from 'vitest';
import { kit } from '../index';
import { contract } from './page';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
const EX: Parameters<typeof kit.html.page>[0] = { body: '<p>Column</p>' };
beforeEach(() => { document.body.replaceChildren(); });

describe('story: Page', () => {
  it('draws the component its contract names (data-kit="Page")', () => {
    const el = put(kit.page(EX));
    expect(el.matches('[data-kit~="Page"]') || !!el.querySelector('[data-kit~="Page"]')).toBe(true);
    expect(contract.name).toBe('Page');
  });
  it('the column is the main landmark; a settings page is named by its title, with its scope', () => {
    expect(put(kit.page(EX)).tagName).toBe('MAIN');
    const s = put(kit.page({ variant: 'settings', title: 'General', scope: { items: [{ value: 'all', label: 'Every bot' }], value: 'all' } }));
    expect([s.tagName, s.getAttribute('aria-label')]).toEqual(['SECTION', 'General']);
    expect(s.querySelector('[data-kit~="Segmented"]')).not.toBeNull();
  });
});
