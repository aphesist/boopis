// @vitest-environment jsdom
/* AskCard: its tests at the kit's two unit levels (docs/kit/TERMS.md). Story: its props drawn as markup and states. Scene: its
   behaviour in jsdom, keys and clicks to events and ARIA. */
import { beforeEach, describe, expect, it } from 'vitest';
import { kit } from '../index';
import { contract } from './ask-card';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
const EX: Parameters<typeof kit.html.askCard>[0] = { ask: 'Run the tests?' };
beforeEach(() => { document.body.replaceChildren(); });

describe('story: AskCard', () => {
  it('draws the component its contract names (data-kit="AskCard")', () => {
    const el = put(kit.askCard(EX));
    expect(el.matches('[data-kit~="AskCard"]') || !!el.querySelector('[data-kit~="AskCard"]')).toBe(true);
    expect(contract.name).toBe('AskCard');
  });
  it('a group named by its question, in its state; an approval offers the hold first', () => {
    const a = put(kit.askCard({ ask: 'Run the tests?', who: 'kai' }));
    expect([a.getAttribute('role'), a.getAttribute('aria-label'), a.dataset['state'], a.dataset['variant']]).toEqual(['group', 'Run the tests?', 'needs', 'standalone']);
    const first = a.querySelector<HTMLElement>('[data-kit~="Chip"]');
    expect(first?.hasAttribute('data-hold')).toBe(true);
  });
  it('answered, it is one row that says what was chosen', () => {
    const a = put(kit.askCard({ ask: 'Run the tests?', state: 'answered', receipt: 'Allowed once' }));
    expect(a.dataset['state']).toBe('answered');
    expect(a.textContent).toContain('Allowed once');
    expect(a.querySelector('[data-kit~="Chip"]')).toBeNull();
  });
});
