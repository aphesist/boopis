// @vitest-environment jsdom
/* Pane: its tests at the kit's two unit levels (docs/kit/TERMS.md). Story: its props drawn as markup and states. Scene: its
   behaviour in jsdom, keys and clicks to events and ARIA. */
import { beforeEach, describe, expect, it } from 'vitest';
import { kit } from '../index';
import { contract } from './pane';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
const EX: Parameters<typeof kit.html.pane>[0] = { title: 'kai' };
beforeEach(() => { document.body.replaceChildren(); });

describe('story: Pane', () => {
  it('draws the component its contract names (data-kit="Pane")', () => {
    const el = put(kit.pane(EX));
    expect(el.matches('[data-kit~="Pane"]') || !!el.querySelector('[data-kit~="Pane"]')).toBe(true);
    expect(contract.name).toBe('Pane');
  });
  it('a complementary landmark; the tools carry a grip and their tabs', () => {
    const d = put(kit.pane(EX));
    expect([d.getAttribute('role'), d.getAttribute('aria-label'), d.dataset['variant']]).toEqual(['complementary', 'Details', 'details']);
    const t = put(kit.pane({ variant: 'tools' }));
    expect(t.querySelector('.k7-pane__grip')?.getAttribute('role')).toBe('separator');
    expect(t.querySelector('[role="tablist"]')).not.toBeNull();
  });
});
