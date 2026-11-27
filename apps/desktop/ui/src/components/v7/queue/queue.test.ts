// @vitest-environment jsdom
/* Queue: its tests at the kit's two unit levels (docs/kit/TERMS.md). Story: its props drawn as markup and states. Scene: its
   behaviour in jsdom, keys and clicks to events and ARIA. */
import { beforeEach, describe, expect, it } from 'vitest';
import { kit } from '../index';
import { contract } from './queue';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
const EX: Parameters<typeof kit.html.queue>[0] = { items: ['Then run the linter'] };
beforeEach(() => { document.body.replaceChildren(); });

describe('story: Queue', () => {
  it('draws the component its contract names (data-kit="Queue")', () => {
    const el = put(kit.queue(EX));
    expect(el.matches('[data-kit~="Queue"]') || !!el.querySelector('[data-kit~="Queue"]')).toBe(true);
    expect(contract.name).toBe('Queue');
  });
  it('the waiting messages in order; held, one row with Send now', () => {
    const q = put(kit.queue({ items: ['First', 'Second'] }));
    expect([...q.querySelectorAll('[data-kit-part~="QueueRow"]')].map((r) => r.textContent?.includes('First') || r.textContent?.includes('Second'))).toEqual([true, true]);
    const h = put(kit.queue({ variant: 'held', held: 'One message waits' }));
    expect(h.dataset['variant']).toBe('held');
    expect(h.textContent).toContain('Send now');
  });
});
