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
  it('a quiet line: its words, and links that are buttons named by their words', () => {
    const p = put(document.createElement('div'));
    p.innerHTML = kit.html.pageNote({ parts: ['Rules of their own: ', { text: 'kai', attrs: { 'data-open': 'kai' } }, '.'], attrs: { 'data-part': 'own' } });
    const n = p.querySelector('.k7-page__note') as HTMLElement;
    expect(n.textContent).toBe('Rules of their own: kai.');
    const a = n.querySelector('button.k7-page__link') as HTMLButtonElement;
    expect([a.textContent, a.dataset['open'], a.type]).toEqual(['kai', 'kai', 'button']);
    expect(n.dataset['part']).toBe('own');
  });
});
