// @vitest-environment jsdom
/* EmptyState: its tests at the kit's two unit levels (docs/kit/TERMS.md). Story: its props drawn as markup and states. Scene: its
   behaviour in jsdom, keys and clicks to events and ARIA. */
import { beforeEach, describe, expect, it } from 'vitest';
import { kit } from '../index';
import { contract } from './empty-state';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
const EX: Parameters<typeof kit.html.emptyState>[0] = { text: 'No sessions yet' };
beforeEach(() => { document.body.replaceChildren(); });

describe('story: EmptyState', () => {
  it('draws the component its contract names (data-kit="EmptyState")', () => {
    const el = put(kit.emptyState(EX));
    expect(el.matches('[data-kit~="EmptyState"]') || !!el.querySelector('[data-kit~="EmptyState"]')).toBe(true);
    expect(contract.name).toBe('EmptyState');
  });
  it('one line and at most one action; in a list it says so', () => {
    const e = put(kit.emptyState({ text: 'No sessions yet', action: 'New session', place: 'list' }));
    expect(e.querySelector('.k7-empty__text')?.textContent).toBe('No sessions yet');
    expect(e.querySelectorAll('[data-kit~="Button"]').length).toBe(1);
    expect(e.dataset['place']).toBe('list');
  });
});
